import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';

export const GET: RequestHandler = async ({ request, locals: { supabase } }) => {
	// レート制限チェックを最初に実行
	const rateLimitResult = await checkRateLimit(request, rateLimiters?.api);
	if (!rateLimitResult.success) {
		return rateLimitResult.response;
	}

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
