import { env } from '$env/dynamic/public';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { supabase } }) => {
	// supabase.auth.getUser()を使い、安全にユーザー情報を取得
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	let profile = null;
	if (user && !userError) {
		// ログインしている場合、profilesテーブルから氏名を取得します
		const { data } = await supabase
			.from('profiles')
			.select('full_name')
			.eq('id', user.id)
			.single();
		profile = data;
	}

	return {
		user,
		profile,
		supabaseUrl: env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL,
		supabaseAnonKey: env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY
	};
};
