import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	// ユーザーがログインしているかチェック
	const {
		data: { user }
	} = await supabase.auth.getUser();

	// ログインしている場合はダッシュボードにリダイレクト
	if (user) {
		throw redirect(303, '/dashboard');
	}

	// ログインしていない場合はランディングページを表示
	return {};
};
