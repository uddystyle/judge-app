import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
	const { supabase } = locals;

	// 静的コンテンツのため長期キャッシュ（1時間）
	setHeaders({
		'cache-control': 'public, max-age=3600, stale-while-revalidate=7200'
	});

	// getUser()を使用してセキュアにユーザー情報を取得
	const { data: { user } } = await supabase.auth.getUser();

	return {
		user
	};
};
