import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';

export const GET: RequestHandler = async ({ params, url, request, locals: { supabase } }) => {
	// レート制限チェックを最初に実行
	const rateLimitResult = await checkRateLimit(request, rateLimiters?.api);
	if (!rateLimitResult.success) {
		return rateLimitResult.response;
	}

	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	const guestIdentifier = url.searchParams.get('guest');

	// ゲストユーザーの場合
	if (!user && guestIdentifier) {
		// ゲスト参加者情報を検証
		const { data: guestData, error: guestError } = await supabase
			.from('session_participants')
			.select('*')
			.eq('session_id', params.sessionId)
			.eq('guest_identifier', guestIdentifier)
			.eq('is_guest', true)
			.single();

		if (guestError || !guestData) {
			throw error(401, 'Unauthorized');
		}
	} else if (userError || !user) {
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
	// owner 列(judge_id/guest_identifier)も返し、修正要求の削除を owner 基準にできるようにする。
	const { data: scores, error: scoresError } = await supabase
		.from('results')
		.select('judge_name, score, judge_id, guest_identifier')
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
		.select(
			'active_prompt_id, is_active, required_judges, chief_judge_id, is_tournament_mode, exclude_extremes'
		)
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(500, 'Failed to fetch session status.');
	}

	// 検定は required_judges（主任設定）、大会は exclude_extremes で 3/5。null は 1 にフォールバック。
	let requiredJudges = sessionData.required_judges || 1;
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
