import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getSafeRedirectPath } from '$lib/safeRedirect';

/**
 * ログインページのサーバーサイドロード処理
 *
 * - 既に認証済みのユーザーは ?next= の安全な遷移先（無ければ /dashboard）へリダイレクト
 * - 未認証ユーザーには検証済みの next を返し、クライアント側でログイン成功時に使用する
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
