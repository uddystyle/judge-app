import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, getSession } }) => {
	const session = await getSession();
	if (!session) {
		throw redirect(303, '/login');
	}

	const sessionId = params.id;

	// セッションの詳細情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*, created_by_profile:profiles(full_name)')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	// 参加者の一覧をプロフィール情報と共に取得
	const { data: participants, error: participantsError } = await supabase
		.from('session_participants')
		.select('user_id, profile:profiles(full_name)')
		.eq('session_id', sessionId);

	if (participantsError) {
		throw error(500, '参加者情報の取得に失敗しました。');
	}

	return {
		currentUserId: session.user.id,
		sessionDetails,
		participants
	};
};
