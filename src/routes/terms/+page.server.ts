import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
	const { supabase } = locals;

	// 静的コンテンツのため長期キャッシュ（1時間）
	setHeaders({
		'cache-control': 'public, max-age=3600, stale-while-revalidate=7200'
	});

	// getUser()を使用してセキュアにユーザー情報を取得
	const { data: { user } } = await supabase.auth.getUser();

	// プロフィール情報を取得
	let profile = null;
	if (user) {
		const { data: profileData } = await supabase
			.from('profiles')
			.select('*')
			.eq('id', user.id)
			.single();
		profile = profileData;
	}

	return {
		user,
		profile
	};
};
