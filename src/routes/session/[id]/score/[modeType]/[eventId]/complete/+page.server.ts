import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const { id: sessionId, modeType, eventId } = params;
	const bib = url.searchParams.get('bib');
	const score = url.searchParams.get('score');

	if (!bib) {
		throw redirect(303, `/session/${sessionId}/score/${modeType}/${eventId}`);
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

	const isChief = user.id === sessionDetails.chief_judge_id;
	const isTrainingMode = modeType === 'training' || sessionDetails.mode === 'training';

	// 研修モードの場合、training_sessionsからis_multi_judgeを取得
	let isMultiJudge = false;
	if (isTrainingMode) {
		const { data: trainingSession } = await supabase
			.from('training_sessions')
			.select('is_multi_judge')
			.eq('session_id', sessionId)
			.maybeSingle();
		isMultiJudge = trainingSession?.is_multi_judge || false;
	} else {
		isMultiJudge = sessionDetails.is_multi_judge || false;
	}

	// モードに応じて種目情報を取得
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

	// 得点情報を取得
	let scores: any[] = [];
	let averageScore = score ? parseFloat(score) : 0;

	if (isTrainingMode) {
		// 研修モードの場合、training_scoresから取得
		const { data: trainingScores } = await supabase
			.from('training_scores')
			.select(`
				*,
				judge:judge_id (
					full_name
				)
			`)
			.eq('event_id', eventId)
			.eq('athlete_id', (await supabase
				.from('participants')
				.select('id')
				.eq('session_id', sessionId)
				.eq('bib_number', parseInt(bib))
				.single()).data?.id || '');

		if (trainingScores) {
			scores = trainingScores.map((s: any) => ({
				judge_name: s.judge?.full_name || '不明',
				score: s.score
			}));

			if (scores.length > 0) {
				const sum = scores.reduce((acc, s) => acc + parseFloat(s.score), 0);
				averageScore = parseFloat((sum / scores.length).toFixed(2));
			}
		}
	} else {
		// 大会モードの場合、resultsから取得
		const { data: resultScores } = await supabase
			.from('results')
			.select('*')
			.eq('session_id', sessionId)
			.eq('bib', parseInt(bib))
			.eq('discipline', eventInfo?.discipline)
			.eq('level', eventInfo?.level)
			.eq('event_name', eventInfo?.event_name);

		if (resultScores) {
			scores = resultScores.map((s: any) => ({
				judge_name: s.judge_name,
				score: s.score
			}));

			if (scores.length > 0) {
				// 大会モードの平均計算（3審3採 / 5審3採対応）
				const sortedScores = [...scores].map(s => parseFloat(s.score)).sort((a, b) => a - b);
				if (sessionDetails.exclude_extremes && sortedScores.length >= 5) {
					// 5審3採: 最高点と最低点を除外
					const middleScores = sortedScores.slice(1, -1);
					const sum = middleScores.reduce((acc, s) => acc + s, 0);
					averageScore = parseFloat((sum / middleScores.length).toFixed(2));
				} else {
					// 3審3採: 単純平均
					const sum = sortedScores.reduce((acc, s) => acc + s, 0);
					averageScore = parseFloat((sum / sortedScores.length).toFixed(2));
				}
			}
		}
	}

	return {
		bib: parseInt(bib),
		sessionDetails,
		eventInfo,
		scores,
		averageScore,
		isChief,
		isMultiJudge,
		isTrainingMode
	};
};

export const actions: Actions = {
	endSession: async ({ params, locals: { supabase } }) => {
		const { id: sessionId } = params;

		const { error } = await supabase
			.from('sessions')
			.update({ is_active: false, active_prompt_id: null })
			.eq('id', sessionId);

		if (error) {
			console.error('Error ending session:', error);
			return { success: false };
		}

		throw redirect(303, '/dashboard');
	},

	changeEvent: async ({ params, locals: { supabase } }) => {
		const { id: sessionId, modeType } = params;

		// active_prompt_idをクリア
		const { error } = await supabase
			.from('sessions')
			.update({ active_prompt_id: null })
			.eq('id', sessionId);

		if (error) {
			console.error('Error changing event:', error);
			return { success: false };
		}

		// 種目選択画面に戻る
		const eventListUrl = modeType === 'training' ? `/session/${sessionId}/training-events` : `/session/${sessionId}/tournament-events`;
		throw redirect(303, eventListUrl);
	}
};
