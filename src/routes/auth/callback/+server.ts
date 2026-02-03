import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const token_hash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type');
	const code = url.searchParams.get('code');
	const nextParam = url.searchParams.get('next') || '/onboarding/create-organization';

	// nextパラメータのバリデーション（オープンリダイレクト対策）
	const allowedPaths = [
		'/dashboard',
		'/onboarding/create-organization',
		'/account'
	];

	// 組織ページへのリダイレクトを許可（/organization/[id]）
	const isOrganizationPath = /^\/organization\/[a-f0-9-]+$/.test(nextParam);

	const next = (allowedPaths.includes(nextParam) || isOrganizationPath)
		? nextParam
		: '/onboarding/create-organization';

	if (nextParam !== next) {
		console.warn('[auth/callback] 不正なリダイレクト先を検出。デフォルトにリダイレクト:', nextParam);
	}

	console.log('[auth/callback] ========== 認証コールバック開始 ==========');
	console.log('[auth/callback] パラメータ:', {
		has_token_hash: !!token_hash,
		has_type: !!type,
		has_code: !!code,
		next,
		original_next: nextParam
	});

	// メール認証リンクから来た場合（codeまたはtoken_hashあり）は、既存セッションチェックをスキップ
	if (!code && !token_hash) {
		console.log('[auth/callback] 認証パラメータなし。既存セッションをチェック...');
		const { data: { user: existingUser } } = await supabase.auth.getUser();
		if (existingUser) {
			console.log('[auth/callback] 既に認証済みのユーザー。ダッシュボードへリダイレクト');
			throw redirect(303, '/dashboard');
		}
		console.log('[auth/callback] 認証パラメータも既存セッションもなし');
	} else {
		console.log('[auth/callback] メール認証からのアクセス。認証処理を開始...');
	}

	// PKCEフロー（推奨される方式）
	if (code) {
		try {
			console.log('[auth/callback] コードフローで認証を試みます');
			console.log('[auth/callback] code:', code.substring(0, 10) + '...');
			console.log('[auth/callback] next:', next);

			const { data, error } = await supabase.auth.exchangeCodeForSession(code);

			if (error) {
				console.error('[auth/callback] コード交換エラー:', error);
				console.error('[auth/callback] エラーコード:', error.code);
				console.error('[auth/callback] エラーメッセージ:', error.message);
				console.error('[auth/callback] エラー詳細:', JSON.stringify(error));

				// 既に使用済みのコードの場合、既存セッションを確認
				if (error.message.includes('code verifier') || error.message.includes('invalid') || error.message.includes('already been used')) {
					console.log('[auth/callback] コードが使用済みまたは無効。現在のセッションを確認...');
					// 既に認証済みかチェック
					const { data: { user: currentUser } } = await supabase.auth.getUser();
					if (currentUser) {
						console.log('[auth/callback] コードは使用済みだが、ユーザーは認証済み。ダッシュボードへリダイレクト');
						throw redirect(303, '/dashboard');
					}
					console.log('[auth/callback] セッションも存在しない。ログインへリダイレクト');
					throw redirect(303, '/login');
				}

				console.error('[auth/callback] 予期しないエラー。ログインページへリダイレクト');
				throw redirect(303, `/login?error=${encodeURIComponent('認証に失敗しました: ' + error.message)}`);
			}

			console.log('[auth/callback] 認証成功、ユーザー:', data.user?.email);
			console.log('[auth/callback] セッション作成完了');
			console.log('[auth/callback] リダイレクト先:', next);
			throw redirect(303, next);
		} catch (error: any) {
			// redirectのthrowは正常な動作なので再スロー
			if (error?.status === 303) throw error;

			console.error('[auth/callback] コード交換処理エラー:', error);
			console.error('[auth/callback] エラータイプ:', typeof error);
			console.error('[auth/callback] エラー内容:', JSON.stringify(error, null, 2));
			throw redirect(303, `/login?error=${encodeURIComponent('認証処理中にエラーが発生しました: ' + (error?.message || '不明なエラー'))}`);
		}
	}

	// トークンハッシュフロー（古い方式との互換性）
	if (token_hash && type) {
		try {
			console.log('[auth/callback] トークンハッシュフローで認証を試みます');
			const { error } = await supabase.auth.verifyOtp({
				token_hash,
				type: type as any
			});

			if (error) {
				console.error('[auth/callback] トークン検証エラー:', error);
				throw redirect(303, `/login?error=${encodeURIComponent('認証に失敗しました: ' + error.message)}`);
			}

			console.log('[auth/callback] 認証成功、リダイレクト:', next);
			throw redirect(303, next);
		} catch (error: any) {
			// redirectのthrowは正常な動作なので再スロー
			if (error?.status === 303) throw error;

			console.error('[auth/callback] トークン検証処理エラー:', error);
			throw redirect(303, `/login?error=${encodeURIComponent('認証処理中にエラーが発生しました')}`);
		}
	}

	// パラメータがない場合
	console.error('[auth/callback] 認証パラメータが見つかりません');
	console.error('[auth/callback] URL:', url.toString());
	throw redirect(303, `/login?error=${encodeURIComponent('無効な認証リンクです。認証パラメータが見つかりません。')}`);
};
