import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { supabase } = locals;

	// getUser()を使用してセキュアにユーザー情報を取得
	const { data: { user } } = await supabase.auth.getUser();

	let profile = null;
	if (user) {
		const { data } = await supabase
			.from('profiles')
			.select('id, full_name, avatar_url')
			.eq('id', user.id)
			.single();
		profile = data;
	}

	return {
		user,
		profile
	};
};
