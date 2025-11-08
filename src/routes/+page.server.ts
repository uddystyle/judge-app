import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase }, url }) => {
	// ユーザーがログインしているかチェック
	const {
		data: { user }
	} = await supabase.auth.getUser();

	// クエリパラメータで明示的にトップページ表示を指定している場合はリダイレクトしない
	const forceView = url.searchParams.get('view') === 'landing';

	// ログインしている場合、かつ強制表示フラグがない場合はダッシュボードにリダイレクト
	if (user && !forceView) {
		throw redirect(303, '/dashboard');
	}

	// ログインしていない場合、または強制表示フラグがある場合はランディングページを表示
	return {
		user // ユーザー情報を返す（ログイン済みの場合、ヘッダー表示のため）
	};
};
