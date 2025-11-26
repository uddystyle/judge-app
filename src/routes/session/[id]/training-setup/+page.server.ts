import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const { id: sessionId } = params;

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, 'セッションが見つかりません。');
	}

	// 研修モードでない場合はダッシュボードにリダイレクト
	if (sessionDetails.mode !== 'training') {
		throw redirect(303, '/dashboard');
	}

	// 研修種目の数を取得
	const { count: eventsCount } = await supabase
		.from('training_events')
		.select('*', { count: 'exact', head: true })
		.eq('session_id', sessionId);

	// 参加者の数を取得
	const { count: participantsCount } = await supabase
		.from('participants')
		.select('*', { count: 'exact', head: true })
		.eq('session_id', sessionId);

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
		profile,
		sessionDetails,
		eventsCount: eventsCount || 0,
		participantsCount: participantsCount || 0
	};
};
