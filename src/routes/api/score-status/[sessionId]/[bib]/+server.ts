import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw error(401, 'Unauthorized');
	}

	const { sessionId, bib } = params;
	const discipline = url.searchParams.get('discipline');
	const level = url.searchParams.get('level');
	const eventName = url.searchParams.get('event');

	if (!discipline || !level || !eventName) {
		throw error(400, 'Missing required query parameters.');
	}

	// Get all scores for this specific entry
	const { data: scores, error: scoresError } = await supabase
		.from('results')
		.select('judge_name, score')
		.eq('session_id', sessionId)
		.eq('bib', bib)
		.eq('discipline', discipline)
		.eq('level', level)
		.eq('event_name', eventName);

	if (scoresError) {
		throw error(500, 'Failed to fetch scores.');
	}

	// Get the session's settings
	const { data: sessionData, error: sessionError } = await supabase
		.from('sessions')
		.select('active_prompt_id, is_active, required_judges, chief_judge_id, is_tournament_mode, exclude_extremes')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(500, 'Failed to fetch session status.');
	}

	// 大会モードの場合は exclude_extremes に基づいて必要な検定員数を決定
	let requiredJudges = sessionData.required_judges;
	if (sessionData.is_tournament_mode) {
		requiredJudges = sessionData.exclude_extremes ? 5 : 3;
	}

	return json({
		scores: scores,
		isActive: sessionData.is_active,
		requiredJudges: requiredJudges,
		chiefJudgeId: sessionData.chief_judge_id
	});
};
