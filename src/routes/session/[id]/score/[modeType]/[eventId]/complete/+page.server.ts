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
	let displayScore = score ? parseFloat(score) : 0;

	if (isTrainingMode) {
		// 研修モードの場合、training_scoresから取得
		const participantResult = await supabase
			.from('participants')
			.select('id')
			.eq('session_id', sessionId)
			.eq('bib_number', parseInt(bib))
			.single();

		const participantId = participantResult.data?.id;

		if (participantId) {
			const { data: trainingScores } = await supabase
				.from('training_scores')
				.select('*')
				.eq('event_id', eventId)
				.eq('athlete_id', participantId);

			if (trainingScores) {
				// judge_idからprofilesテーブルを使って名前を取得
				const scoresWithNames = await Promise.all(
					trainingScores.map(async (s: any) => {
						const { data: profile } = await supabase
							.from('profiles')
							.select('full_name')
							.eq('id', s.judge_id)
							.single();

						return {
							judge_name: profile?.full_name || '不明',
							score: s.score
						};
					})
				);

				scores = scoresWithNames;

				if (scores.length > 0) {
					const sum = scores.reduce((acc, s) => acc + parseFloat(s.score), 0);
					displayScore = parseFloat((sum / scores.length).toFixed(2));
				}
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

			// 大会モード: URLパラメータでスコアが渡されている場合はそれを使用（主任検定員が確定した合計点）
			// URLパラメータがない場合のみデータベースから計算（一般検定員の場合など）
			if (!score && scores.length > 0) {
				// 合計点を計算（3審3採 / 5審3採対応）
				const sortedScores = [...scores].map(s => parseFloat(s.score)).sort((a, b) => a - b);
				if (sessionDetails.exclude_extremes && sortedScores.length >= 5) {
					// 5審3採: 最高点と最低点を除外した3人の合計
					const middleScores = sortedScores.slice(1, -1);
					displayScore = parseFloat(middleScores.reduce((acc, s) => acc + s, 0).toFixed(2));
				} else {
					// 3審3採: 全員の合計
					displayScore = parseFloat(sortedScores.reduce((acc, s) => acc + s, 0).toFixed(2));
				}
			}
		}
	}

	return {
		bib: parseInt(bib),
		sessionDetails,
		eventInfo,
		scores,
		displayScore,
		isChief,
		isMultiJudge,
		isTrainingMode
	};
};

export const actions: Actions = {
	endSession: async ({ params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return { success: false, error: '認証が必要です。' };
		}

		const { id: sessionId, modeType } = params;

		// セッション情報を取得して権限確認
		const { data: sessionDetails, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id, is_multi_judge, mode')
			.eq('id', sessionId)
			.single();

		if (sessionError) {
			console.error('Error fetching session:', sessionError);
			return { success: false, error: '検定が見つかりません。' };
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
		} else if (modeType === 'tournament') {
			// 大会モードは常に複数検定員モードON
			isMultiJudge = true;
		} else {
			isMultiJudge = sessionDetails.is_multi_judge || false;
		}

		// 主任検定員または複数検定員モードOFFの場合のみ実行可能
		if (!isChief && isMultiJudge) {
			return { success: false, error: 'セッションを終了する権限がありません。' };
		}

		// セッションを非アクティブにし、active_prompt_idをクリア
		const { error } = await supabase
			.from('sessions')
			.update({ is_active: false, active_prompt_id: null })
			.eq('id', sessionId);

		if (error) {
			console.error('Error ending session:', error);
			return { success: false };
		}

		// 主任検定員かつ複数検定員モードの場合は終了通知を挿入
		if (isChief && isMultiJudge) {
			console.log('[主任検定員] 終了通知を挿入中...', { session_id: sessionId, modeType, isMultiJudge });
			const { error: notificationError } = await supabase
				.from('session_notifications')
				.insert({
					session_id: sessionId,
					notification_type: 'session_ended'
				});

			if (notificationError) {
				console.error('[主任検定員] ❌ 終了通知の挿入に失敗:', notificationError);
			}
		}

		// セッション詳細画面（終了画面）にリダイレクト
		throw redirect(303, `/session/${sessionId}?ended=true`);
	},

	changeEvent: async ({ params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return { success: false, error: '認証が必要です。' };
		}

		const { id: sessionId, modeType } = params;

		// セッション情報を取得して権限確認
		const { data: sessionDetails, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id, is_multi_judge')
			.eq('id', sessionId)
			.single();

		if (sessionError) {
			console.error('Error fetching session:', sessionError);
			return { success: false, error: '検定が見つかりません。' };
		}

		const isChief = user.id === sessionDetails.chief_judge_id;

		// 主任検定員または複数検定員モードOFFの場合のみ実行可能
		if (!isChief && sessionDetails.is_multi_judge) {
			return { success: false, error: '種目を変更する権限がありません。' };
		}

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
