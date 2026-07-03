import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, locals: { supabase } }) => {
	// supabase.auth.getUser()を使い、安全にユーザー情報を取得
	// プロフィール情報は各ページで必要な場合のみ取得（パフォーマンス最適化）
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	return {
		user: user && !userError ? user : null,
		lang: locals.lang ?? 'ja'
	};
};
