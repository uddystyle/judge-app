import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

/**
 * ログインページのサーバーサイドロード処理
 *
 * 既に認証済みのユーザーがログインページにアクセスした場合、
 * ダッシュボードにリダイレクトする（SSRで処理）
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const {
		data: { user }
	} = await supabase.auth.getUser();

	// 既にログイン済みの場合、ダッシュボードにリダイレクト
	if (user) {
		throw redirect(303, '/dashboard');
	}

	return {};
};
