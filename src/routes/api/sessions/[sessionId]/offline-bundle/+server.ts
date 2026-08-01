import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';
import { authenticateAction } from '$lib/server/sessionAuth';

/**
 * セッションのオフライン利用バンドル（network-resilience-strategy.md Phase 4）
 *
 * 採点フローのクライアントが事前ダウンロードして IndexedDB に保存する。
 * 参加者一覧と種目情報のみ（採点結果や個人情報は含めない）。
 */
export const GET: RequestHandler = async ({ params, url, request, locals: { supabase } }) => {
	const rateLimitResult = await checkRateLimit(request, rateLimiters?.api);
	if (!rateLimitResult.success) {
		return rateLimitResult.response;
	}

	const { sessionId } = params;
	const guestIdentifier = url.searchParams.get('guest');

	const auth = await authenticateAction(supabase, sessionId, guestIdentifier);
	if (!auth) {
		throw error(401, 'Unauthorized');
	}

	const { data: session, error: sessionError } = await supabase
		.from('sessions')
		.select('id, name, mode, is_tournament_mode')
		.eq('id', sessionId)
		.single();

	if (sessionError || !session) {
		throw error(404, 'Session not found.');
	}

	// scoreSync.ts と同じモード判定
	const mode =
		session.mode === 'training'
			? 'training'
			: session.is_tournament_mode || session.mode === 'tournament'
				? 'tournament'
				: 'certification';

	const { data: participants, error: participantsError } = await supabase
		.from('participants')
		.select('id, bib_number, athlete_name, team_name')
		.eq('session_id', sessionId)
		.order('bib_number');

	if (participantsError) {
		throw error(500, 'Failed to fetch participants.');
	}

	let trainingEvents: unknown[] = [];
	let customEvents: unknown[] = [];

	if (mode === 'training') {
		const { data, error: eventsError } = await supabase
			.from('training_events')
			.select('id, name, min_score, max_score')
			.eq('session_id', sessionId)
			.order('order_index');
		if (eventsError) {
			throw error(500, 'Failed to fetch training events.');
		}
		trainingEvents = data ?? [];
	} else if (mode === 'tournament') {
		const { data, error: eventsError } = await supabase
			.from('custom_events')
			.select('id, discipline, level, event_name')
			.eq('session_id', sessionId)
			.order('display_order');
		if (eventsError) {
			throw error(500, 'Failed to fetch custom events.');
		}
		customEvents = data ?? [];
	}

	return json({
		session_id: session.id,
		session_name: session.name,
		mode,
		participants: participants ?? [],
		training_events: trainingEvents,
		custom_events: customEvents
	});
};
