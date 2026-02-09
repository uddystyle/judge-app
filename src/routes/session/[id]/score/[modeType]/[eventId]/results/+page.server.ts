import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { authenticateSession } from '$lib/server/sessionAuth';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const { id: sessionId, modeType, eventId } = params;
	const guestIdentifier = url.searchParams.get('guest');

	// セッション認証
	const { user, guestParticipant } = await authenticateSession(
		supabase,
		sessionId,
		guestIdentifier
	);

	const currentUserId = user?.id || null;

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	const isTrainingMode = modeType === 'training' || sessionDetails.mode === 'training';

	// 種目情報を取得
	let eventInfo: any = null;
	if (isTrainingMode) {
		const { data: trainingEvent } = await supabase
			.from('training_events')
			.select('*')
			.eq('id', eventId)
			.eq('session_id', sessionId)
			.single();
		eventInfo = trainingEvent;
	} else {
		const { data: customEvent } = await supabase
			.from('custom_events')
			.select('*')
			.eq('id', eventId)
			.eq('session_id', sessionId)
			.single();
		eventInfo = customEvent;
	}

	// プロフィール情報を取得（認証ユーザーの場合のみ）
	let profile = null;
	if (user) {
		const { data: profileData } = await supabase
			.from('profiles')
			.select('*')
			.eq('id', user.id)
			.single();

		profile = profileData;
	}

	// 種目一覧を取得
	let allEvents: any[] = [];
	if (isTrainingMode) {
		const { data: trainingEvents } = await supabase
			.from('training_events')
			.select('id, name')
			.eq('session_id', sessionId)
			.order('order_index', { ascending: true });

		allEvents = trainingEvents || [];
	} else {
		const { data: customEvents } = await supabase
			.from('custom_events')
			.select('id, event_name')
			.eq('session_id', sessionId)
			.order('display_order', { ascending: true });

		allEvents = (customEvents || []).map((e: any) => ({ id: e.id, name: e.event_name }));
	}

	// 現在のユーザーが入力した得点を取得
	let myScores: any[] = [];

	if (isTrainingMode) {
		// セッションのtraining_eventsを取得
		const { data: trainingEvents } = await supabase
			.from('training_events')
			.select('id')
			.eq('session_id', sessionId);

		if (trainingEvents && trainingEvents.length > 0) {
			const eventIds = trainingEvents.map(e => e.id);

			// training_scoresから取得（種目情報も含む、全種目）
			let scoresQuery = supabase
				.from('training_scores')
				.select('*, participants(bib_number), training_events(id, name)')
				.in('event_id', eventIds);

			if (guestIdentifier) {
				// ゲストユーザーの場合
				scoresQuery = scoresQuery.eq('guest_identifier', guestIdentifier);
			} else if (currentUserId) {
				// 認証ユーザーの場合
				scoresQuery = scoresQuery.eq('judge_id', currentUserId);
			}

			const { data: trainingScores, error: scoresError } = await scoresQuery.order('created_at', { ascending: true });

			console.log('[results/load] training_scores取得:', { trainingScores, scoresError, guestIdentifier, currentUserId });

			if (trainingScores) {
				myScores = trainingScores.map((s: any) => ({
					bib_number: s.participants?.bib_number || 0,
					score: s.score,
					event_id: s.training_events?.id || '',
					event_name: s.training_events?.name || '',
					created_at: s.created_at
				}));
			}
		}
	} else {
		// 大会モードの場合、resultsから取得（全種目）
		const judgeName = profile?.full_name || guestParticipant?.guest_name || '';

		if (judgeName) {
			const { data: results, error: resultsError } = await supabase
				.from('results')
				.select('*')
				.eq('session_id', sessionId)
				.eq('judge_name', judgeName)
				.order('created_at', { ascending: true });

			console.log('[results/load] results取得:', { results, resultsError, judgeName });

			if (results) {
				myScores = results.map((r: any) => {
					// event_idを event_name から探す
					const event = allEvents.find(e => e.name === r.event_name);
					return {
						bib_number: r.bib,
						score: r.score,
						event_id: event?.id || '',
						event_name: r.event_name,
						created_at: r.created_at
					};
				});
			}
		}
	}

	return {
		user,
		profile,
		sessionDetails,
		eventInfo,
		isTrainingMode,
		myScores,
		allEvents,
		guestParticipant,
		guestIdentifier
	};
};
