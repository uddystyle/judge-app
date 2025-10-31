import { json, redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	// Only logged-in users can export data
	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const { sessionId } = params;

	// セッションIDのバリデーション
	const sessionIdNum = parseInt(sessionId);
	if (isNaN(sessionIdNum)) {
		throw error(400, '無効なセッションIDです。');
	}

	// ユーザーがこのセッションの参加者かどうかをチェック
	const { data: participant, error: participantError } = await supabase
		.from('session_participants')
		.select('id')
		.eq('session_id', sessionIdNum)
		.eq('user_id', user.id)
		.single();

	if (participantError || !participant) {
		console.error('Unauthorized export attempt:', { userId: user.id, sessionId: sessionIdNum });
		throw error(403, 'このセッションにアクセスする権限がありません。');
	}

	// Fetch all results for the given session ID from the 'results' table
	const { data, error: resultsError } = await supabase
		.from('results')
		.select('created_at, bib, score, discipline, level, event_name, judge_name')
		.eq('session_id', sessionIdNum)
		.order('created_at', { ascending: true }); // Order by time

	if (resultsError) {
		console.error('Failed to fetch results:', resultsError);
		return json({ error: '結果の取得に失敗しました。' }, { status: 500 });
	}

	// Return the data as a JSON response
	return json({ results: data });
};
