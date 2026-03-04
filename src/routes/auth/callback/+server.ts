import { redirect, isRedirect, isHttpError } from '@sveltejs/kit';
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

	// 組織ページへのリダイレクトを許可（/organization/[uuid]）
	// UUID v4形式に厳密化：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
	// - x: 16進数 (0-9a-f)
	// - 4: バージョン4固定
	// - y: バリアント (8, 9, a, b のいずれか)
	const UUID_V4_PATTERN = /^\/organization\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
	const isOrganizationPath = UUID_V4_PATTERN.test(nextParam);

	// 招待完了ページへのリダイレクトを許可（/invite/[token]/complete）
	// トークンは英数字とハイフンのみ（最大64文字）
	const INVITE_COMPLETE_PATTERN = /^\/invite\/[a-zA-Z0-9-]{1,64}\/complete$/;
	const isInviteCompletePath = INVITE_COMPLETE_PATTERN.test(nextParam);

	const next = (allowedPaths.includes(nextParam) || isOrganizationPath || isInviteCompletePath)
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
				console.error('[auth/callback] コード交換エラー:', {
					code: error.code,
					message: error.message,
					status: (error as any).status,
					details: error
				});

				// エラーコードベースの判定（文字列マッチングではなくコード判定）
				// Supabase Auth エラーコード: https://supabase.com/docs/reference/javascript/auth-error-codes
				if (error.code === 'invalid_grant') {
					// invalid_grant: コードが無効、期限切れ、または既に使用済み
					console.log('[auth/callback] invalid_grant検出。コードが使用済み/無効/期限切れ。現在のセッションを確認...');

					// 既に認証済みかチェック
					const { data: { user: currentUser } } = await supabase.auth.getUser();
					if (currentUser) {
						console.log('[auth/callback] コードは使用済みだが、ユーザーは認証済み。ダッシュボードへリダイレクト');
						throw redirect(303, '/dashboard');
					}

					console.log('[auth/callback] セッションも存在しない。ログインへリダイレクト（再利用リンク案内）');
					throw redirect(
						303,
						`/login?error=${encodeURIComponent(
							'認証リンクが既に使用済みか無効です。登録済みの場合はそのままログインしてください。'
						)}`
					);
				}

				if (error.code === 'otp_expired') {
					// OTP/コードが期限切れ
					console.error('[auth/callback] otp_expired検出。コードが期限切れ');
					throw redirect(303, `/login?error=${encodeURIComponent('認証リンクの有効期限が切れています。再度サインアップしてください。')}`);
				}

				// その他の予期しないエラー
				console.error('[auth/callback] 予期しないエラーコード:', error.code);
				throw redirect(303, `/login?error=${encodeURIComponent('認証に失敗しました。再度お試しください。')}`);
			}

			console.log('[auth/callback] 認証成功、ユーザー:', data.user?.email);
			console.log('[auth/callback] セッション作成完了');
			console.log('[auth/callback] リダイレクト先:', next);
			throw redirect(303, next);
		} catch (error: any) {
			// SvelteKitのredirectやerrorは再throw（正常な制御フロー）
			if (isRedirect(error) || isHttpError(error)) {
				throw error;
			}

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
			// SvelteKitのredirectやerrorは再throw（正常な制御フロー）
			if (isRedirect(error) || isHttpError(error)) {
				throw error;
			}

			console.error('[auth/callback] トークン検証処理エラー:', error);
			throw redirect(303, `/login?error=${encodeURIComponent('認証処理中にエラーが発生しました')}`);
		}
	}

	// パラメータがない場合
	console.error('[auth/callback] 認証パラメータが見つかりません');
	console.error('[auth/callback] URL:', url.toString());
	throw redirect(303, `/login?error=${encodeURIComponent('無効な認証リンクです。認証パラメータが見つかりません。')}`);
};
