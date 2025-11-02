import { error, redirect, fail } from '@sveltejs/kit';
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
	const bibNumber = url.searchParams.get('bib');
	const participantId = url.searchParams.get('participantId');

	if (!bibNumber || !participantId) {
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

	// モードに応じて種目情報を取得
	let eventInfo: any = null;
	let isTrainingMode = false;

	if (modeType === 'training' || sessionDetails.mode === 'training') {
		isTrainingMode = true;
		const { data: trainingEvent, error: eventError } = await supabase
			.from('training_events')
			.select('*')
			.eq('id', eventId)
			.eq('session_id', sessionId)
			.single();

		if (eventError) {
			throw error(404, '種目が見つかりません。');
		}
		eventInfo = trainingEvent;
	} else {
		const { data: customEvent, error: eventError } = await supabase
			.from('custom_events')
			.select('*')
			.eq('id', eventId)
			.eq('session_id', sessionId)
			.single();

		if (eventError) {
			throw error(404, '種目が見つかりません。');
		}
		eventInfo = customEvent;
	}

	// 参加者情報を取得
	const { data: participant } = await supabase
		.from('participants')
		.select('*')
		.eq('id', participantId)
		.single();

	// 研修モードの場合、training_sessionsからis_multi_judgeを取得
	let isMultiJudge = false;
	if (isTrainingMode) {
		const { data: trainingSession } = await supabase
			.from('training_sessions')
			.select('is_multi_judge')
			.eq('session_id', sessionId)
			.maybeSingle();
		isMultiJudge = trainingSession?.is_multi_judge || false;
	} else if (modeType === 'tournament') {
		// 大会モードは常に複数検定員モードON
		isMultiJudge = true;
	} else {
		isMultiJudge = sessionDetails.is_multi_judge || false;
	}

	const isChief = user.id === sessionDetails.chief_judge_id;

	return {
		sessionDetails,
		eventInfo,
		participant,
		bibNumber: parseInt(bibNumber),
		participantId,
		isTrainingMode,
		isMultiJudge,
		isChief
	};
};

export const actions: Actions = {
	submitScore: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		const formData = await request.formData();
		const score = parseFloat(formData.get('score') as string);
		const participantId = formData.get('participantId') as string;
		const bibNumber = parseInt(formData.get('bibNumber') as string);

		const { id: sessionId, modeType, eventId } = params;

		// 得点をデータベースに保存
		if (modeType === 'training') {
			// 既存のスコアを確認
			const { data: existingScore } = await supabase
				.from('training_scores')
				.select('id')
				.eq('event_id', eventId)
				.eq('judge_id', user.id)
				.eq('athlete_id', participantId)
				.maybeSingle();

			let saveError;

			if (existingScore) {
				// 既存スコアを更新
				const { error } = await supabase
					.from('training_scores')
					.update({
						score: score,
						is_finalized: true,
						updated_at: new Date().toISOString()
					})
					.eq('id', existingScore.id);
				saveError = error;
			} else {
				// 新規スコアを挿入
				const { error } = await supabase
					.from('training_scores')
					.insert({
						event_id: eventId,
						judge_id: user.id,
						athlete_id: participantId,
						score: score,
						is_finalized: true
					});
				saveError = error;
			}

			if (saveError) {
				console.error('Error saving training score:', saveError);
				return fail(500, { error: '採点の保存に失敗しました。' });
			}
		} else {
			// 大会モード - resultsテーブルに保存
			const { data: eventData } = await supabase
				.from('custom_events')
				.select('*')
				.eq('id', eventId)
				.single();

			if (!eventData) {
				return fail(404, { error: '種目が見つかりません。' });
			}

			const { data: profile } = await supabase
				.from('profiles')
				.select('full_name')
				.eq('id', user.id)
				.single();

			const { error: insertError } = await supabase.from('results').upsert(
				{
					session_id: sessionId,
					bib: bibNumber,
					score: score,
					judge_name: profile?.full_name || user.email,
					discipline: eventData.discipline,
					level: eventData.level,
					event_name: eventData.event_name
				},
				{
					onConflict: 'session_id, bib, discipline, level, event_name, judge_name'
				}
			);

			if (insertError) {
				console.error('Error saving tournament score:', insertError);
				return fail(500, { error: '採点の保存に失敗しました。' });
			}
		}

		return {
			success: true,
			score,
			bibNumber
		};
	}
};
