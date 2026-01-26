import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	const { id: sessionId, modeType, eventId } = params;
	const guestIdentifier = url.searchParams.get('guest');

	// ゲストユーザーの情報を保持
	let guestParticipant = null;
	let currentUserId: string | null = null;

	// ゲストユーザーの場合
	if (!user && guestIdentifier) {
		// ゲスト参加者情報を検証
		const { data: guestData, error: guestError } = await supabase
			.from('session_participants')
			.select('*')
			.eq('session_id', sessionId)
			.eq('guest_identifier', guestIdentifier)
			.eq('is_guest', true)
			.maybeSingle();

		if (guestError || !guestData) {
			throw redirect(303, '/session/join');
		}

		guestParticipant = guestData;
	} else if (userError || !user) {
		throw redirect(303, '/login');
	} else {
		currentUserId = user.id;
	}

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
			.single();
		eventInfo = trainingEvent;
	} else {
		const { data: customEvent } = await supabase
			.from('custom_events')
			.select('*')
			.eq('id', eventId)
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

	// 現在のユーザーが入力した得点を取得
	let myScores: any[] = [];

	if (isTrainingMode) {
		// training_scoresから取得
		let scoresQuery = supabase
			.from('training_scores')
			.select('*, participants(bib_number)')
			.eq('event_id', eventId);

		if (guestIdentifier) {
			// ゲストユーザーの場合
			scoresQuery = scoresQuery.eq('guest_identifier', guestIdentifier);
		} else if (currentUserId) {
			// 認証ユーザーの場合
			scoresQuery = scoresQuery.eq('judge_id', currentUserId);
		}

		const { data: trainingScores, error: scoresError } = await scoresQuery;

		console.log('[results/load] training_scores取得:', { trainingScores, scoresError, guestIdentifier, currentUserId });

		if (trainingScores) {
			myScores = trainingScores.map((s: any) => ({
				bib_number: s.participants?.bib_number || 0,
				score: s.score,
				created_at: s.created_at
			})).sort((a, b) => a.bib_number - b.bib_number);
		}
	} else {
		// 大会モードの場合、resultsから取得
		const judgeName = profile?.full_name || guestParticipant?.guest_name || '';

		if (judgeName) {
			const { data: results, error: resultsError } = await supabase
				.from('results')
				.select('*')
				.eq('session_id', sessionId)
				.eq('discipline', eventInfo?.discipline || '')
				.eq('level', eventInfo?.level || '')
				.eq('event_name', eventInfo?.event_name || '')
				.eq('judge_name', judgeName);

			console.log('[results/load] results取得:', { results, resultsError, judgeName });

			if (results) {
				myScores = results.map((r: any) => ({
					bib_number: r.bib,
					score: r.score,
					created_at: r.created_at
				})).sort((a, b) => a.bib_number - b.bib_number);
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
		guestParticipant,
		guestIdentifier
	};
};
