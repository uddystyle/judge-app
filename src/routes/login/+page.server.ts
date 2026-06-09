import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getSafeRedirectPath } from '$lib/safeRedirect';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';
import * as m from '$lib/paraglide/messages.js';

/**
 * メールアドレスを正規化（小文字化 + トリム）
 * サインアップと同じ正規化を適用し、一貫性を保つ
 */
function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * ログインページのサーバーサイドロード処理
 *
 * - 既に認証済みのユーザーは ?next= の安全な遷移先（無ければ /dashboard）へリダイレクト
 * - 未認証ユーザーには検証済みの next を返し、ログイン成功時のリダイレクト先に使用する
 */
export const load: PageServerLoad = async ({ locals: { supabase }, url }) => {
	const next = getSafeRedirectPath(url.searchParams.get('next'), '/dashboard');

	const {
		data: { user }
	} = await supabase.auth.getUser();

	if (user) {
		throw redirect(303, next);
	}

	return { next };
};

/**
 * ログインのサーバーサイドアクション
 *
 * ログインをサーバー側で実行することで、アプリ独自のレート制限（Upstash auth リミッター）を
 * 適用できるようにする（クライアント側 signInWithPassword では適用されなかった）。
 * 認証成功時は @supabase/ssr のサーバークライアントが auth クッキーを設定するため、
 * ブラウザのクライアントも次のロードでセッションを認識する。signup / reset-password と同じパターン。
 */
export const actions: Actions = {
	default: async ({ request, locals: { supabase } }) => {
		// レート制限チェックを最初に実行（IPベース。signup / reset と同じ auth リミッター）
		// 認証前のためユーザーIDは渡さない（getClientIdentifier が IP にフォールバック）
		const rateLimitResult = await checkRateLimit(request, rateLimiters?.auth);
		if (!rateLimitResult.success) {
			return fail(429, { email: '', error: m.auth_rateLimited() });
		}

		const formData = await request.formData();
		const email = normalizeEmail((formData.get('email') as string) ?? '');
		const password = (formData.get('password') as string) ?? '';
		// next はフォームの hidden field から受け取り、サーバー側で再検証（オープンリダイレクト対策）
		const next = getSafeRedirectPath((formData.get('next') as string) ?? null, '/dashboard');

		if (!email || !password) {
			return fail(400, { email, error: m.auth_loginFailed() });
		}

		const { error } = await supabase.auth.signInWithPassword({ email, password });

		if (error) {
			// 最小限のエラー情報のみログ出力（個人情報保護）
			console.error('[login] signIn error:', {
				code: error.code,
				status: (error as any).status
			});

			// エラーコードベースの判定（文字列マッチングではなくコード判定）
			if (error.code === 'invalid_credentials') {
				return fail(400, { email, error: m.auth_invalidCredentials() });
			}
			if (error.code === 'email_not_confirmed') {
				return fail(400, { email, error: m.auth_emailNotConfirmed() });
			}
			if (error.code === 'too_many_requests' || (error as any).status === 429) {
				return fail(429, { email, error: m.auth_rateLimited() });
			}

			return fail(400, { email, error: m.auth_loginFailed() });
		}

		// 成功 → 検証済み next へリダイレクト（auth クッキーは SSR クライアントが設定済み）
		throw redirect(303, next);
	}
};
