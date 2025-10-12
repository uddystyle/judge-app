import { env } from '$env/dynamic/public';
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

	return {
		session,
		profile,
		supabaseUrl: env.PUBLIC_SUPABASE_URL,
		supabaseAnonKey: env.PUBLIC_SUPABASE_ANON_KEY
	};
};
