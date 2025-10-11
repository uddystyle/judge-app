import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { supabase, getSession } }) => {
	// hooks.server.tsで準備したgetSession関数を使い、セッション情報を取得
	const session = await getSession();

	let profile = null;
	if (session) {
		// ログインしている場合、profilesテーブルから氏名を取得します
		const { data } = await supabase
			.from('profiles')
			.select('full_name')
			.eq('id', session.user.id)
			.single();
		profile = data;
	}

	// 取得したセッション情報と、
	// クライアント側でSupabaseを初期化するためのキーの両方を渡す
	return {
		session,
		profile,
		supabaseUrl: PUBLIC_SUPABASE_URL,
		supabaseAnonKey: PUBLIC_SUPABASE_ANON_KEY
	};
};
