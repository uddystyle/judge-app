import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals: { supabase } }) => {
	// ユーザー情報を取得
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		return json({ user: null, profile: null });
	}

	// プロフィール情報を取得
	const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();

	return json({
		user,
		profile
	});
};
