import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const token_hash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type');
	const code = url.searchParams.get('code');
	const next = url.searchParams.get('next') || '/onboarding/create-organization';

	console.log('[auth/callback] パラメータ:', { token_hash, type, code });

	// PKCEフロー（推奨される方式）
	if (code) {
		try {
			console.log('[auth/callback] コードフローで認証を試みます');
			const { error } = await supabase.auth.exchangeCodeForSession(code);

			if (error) {
				console.error('[auth/callback] コード交換エラー:', error);

				// 既に使用済みのコードの場合
				if (error.message.includes('code verifier') || error.message.includes('invalid')) {
					throw redirect(303, `/login?error=${encodeURIComponent('このリンクは既に使用済みです。ログインページからログインしてください。')}`);
				}

				throw redirect(303, `/login?error=${encodeURIComponent('認証に失敗しました: ' + error.message)}`);
			}

			console.log('[auth/callback] 認証成功、リダイレクト:', next);
			throw redirect(303, next);
		} catch (error: any) {
			// redirectのthrowは正常な動作なので再スロー
			if (error?.status === 303) throw error;

			console.error('[auth/callback] コード交換処理エラー:', error);
			throw redirect(303, `/login?error=${encodeURIComponent('認証処理中にエラーが発生しました')}`);
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
	throw redirect(303, `/login?error=${encodeURIComponent('無効な認証リンクです')}`);
};
