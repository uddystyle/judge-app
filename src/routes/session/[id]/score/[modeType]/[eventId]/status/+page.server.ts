import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	const { id: sessionId, modeType, eventId } = params;
	const guestIdentifier = url.searchParams.get('guest');

	// ゲストユーザーの情報を保持
	let guestParticipant = null;

	// ゲストユーザーの場合
	if (!user && guestIdentifier) {
		// ゲスト参加者情報を検証
		const { data: guestData, error: guestError } = await supabase
			.from('session_participants')
			.select('*')
			.eq('session_id', sessionId)
			.eq('guest_identifier', guestIdentifier)
			.eq('is_guest', true)
			.single();

		if (guestError || !guestData) {
			throw redirect(303, '/session/join');
		}

		guestParticipant = guestData;
	} else if (userError || !user) {
		throw redirect(303, '/login');
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

	const isChief = user ? user.id === sessionDetails.chief_judge_id : false;
	const isTrainingMode = modeType === 'training' || sessionDetails.mode === 'training';
	const isTournamentMode = modeType === 'tournament' || sessionDetails.is_tournament_mode || sessionDetails.mode === 'tournament';

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

	// 研修モードで複数検定員ONの場合、参加検定員の総数を取得
	let totalJudges = 1;
	if (isTrainingMode && isMultiJudge) {
		const { data: participants, count, error: countError } = await supabase
			.from('session_participants')
			.select('*', { count: 'exact' })
			.eq('session_id', sessionId);

		console.log('[status/load] 参加検定員の取得:', { sessionId, isTrainingMode, isMultiJudge, count, participants, countError });
		totalJudges = count || 1;
	}

	return {
		user,
		sessionDetails,
		eventInfo,
		isChief,
		isMultiJudge,
		isTrainingMode,
		isTournamentMode,
		totalJudges,
		guestParticipant,
		guestIdentifier,
		profile
	};
};

export const actions: Actions = {
	requestCorrection: async ({ request, params, locals: { supabase }, url }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		const guestIdentifier = url.searchParams.get('guest');

		// ゲストユーザーの認証
		if (!user && guestIdentifier) {
			const { data: guestData, error: guestError } = await supabase
				.from('session_participants')
				.select('*')
				.eq('guest_identifier', guestIdentifier)
				.eq('is_guest', true)
				.single();

			if (guestError || !guestData) {
				return fail(401, { error: 'ゲスト認証が必要です。' });
			}
		} else if (userError || !user) {
			throw redirect(303, '/login');
		}

		const { id: sessionId, modeType, eventId } = params;
		const formData = await request.formData();
		const bib = formData.get('bib') as string;
		const judgeName = formData.get('judgeName') as string;
		const judgeId = formData.get('judgeId') as string;
		const formGuestIdentifier = formData.get('guestIdentifier') as string;

		if (!bib || !judgeName) {
			return fail(400, { error: 'パラメータが不足しています。' });
		}

		// セッション情報を取得して権限をチェック
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id')
			.eq('id', sessionId)
			.single();

		if (sessionError) {
			return fail(500, { error: 'セッション情報の取得に失敗しました。' });
		}

		const isChief = user ? user.id === sessionData.chief_judge_id : false;

		// 複数検定員モードの確認
		let isMultiJudge = false;
		if (modeType === 'training') {
			const { data: trainingSession } = await supabase
				.from('training_sessions')
				.select('is_multi_judge')
				.eq('session_id', sessionId)
				.maybeSingle();
			isMultiJudge = trainingSession?.is_multi_judge || false;
		} else if (modeType === 'tournament') {
			isMultiJudge = true;
		}

		// 複数検定員モードONの場合、主任検定員のみが修正を要求できる
		if (!isChief && isMultiJudge) {
			return fail(403, { error: '修正を要求する権限がありません。' });
		}

		const isTrainingMode = modeType === 'training';

		// 参加者IDを取得
		const { data: participant } = await supabase
			.from('participants')
			.select('id')
			.eq('session_id', sessionId)
			.eq('bib_number', parseInt(bib))
			.single();

		if (!participant) {
			return fail(404, { error: '参加者が見つかりません。' });
		}

		// モードに応じて得点を削除
		if (isTrainingMode) {
			// ゲストまたは認証ユーザーの判定
			let deleteQuery = supabase
				.from('training_scores')
				.delete()
				.eq('event_id', eventId)
				.eq('athlete_id', participant.id);

			if (formGuestIdentifier) {
				// ゲストユーザーの場合
				console.log('[requestCorrection] Deleting guest score:', formGuestIdentifier);
				deleteQuery = deleteQuery.eq('guest_identifier', formGuestIdentifier);
			} else if (judgeId) {
				// 認証ユーザーの場合（judgeIdがフォームから送信されている）
				console.log('[requestCorrection] Deleting user score:', judgeId);
				deleteQuery = deleteQuery.eq('judge_id', judgeId);
			} else {
				// フォールバック: judge_nameから検定員を特定
				const { data: judgeProfile } = await supabase
					.from('profiles')
					.select('id')
					.eq('full_name', judgeName)
					.maybeSingle();

				if (!judgeProfile) {
					return fail(404, { error: '検定員が見つかりません。' });
				}

				console.log('[requestCorrection] Deleting user score (fallback):', judgeProfile.id);
				deleteQuery = deleteQuery.eq('judge_id', judgeProfile.id);
			}

			const { error: deleteError } = await deleteQuery;

			if (deleteError) {
				console.error('[requestCorrection] Error deleting training score:', deleteError);
				return fail(500, { error: `得点の削除に失敗しました。${deleteError.message || ''}` });
			}
		} else {
			// 大会モードの場合、resultsから削除
			const { data: eventInfo } = await supabase
				.from('custom_events')
				.select('*')
				.eq('id', eventId)
				.single();

			if (!eventInfo) {
				return fail(404, { error: '種目が見つかりません。' });
			}

			const { error: deleteError } = await supabase
				.from('results')
				.delete()
				.eq('session_id', sessionId)
				.eq('bib', parseInt(bib))
				.eq('discipline', eventInfo.discipline)
				.eq('level', eventInfo.level)
				.eq('event_name', eventInfo.event_name)
				.eq('judge_name', judgeName);

			if (deleteError) {
				console.error('Error deleting result:', deleteError);
				return fail(500, { error: '得点の削除に失敗しました。' });
			}
		}

		return { success: true, message: '修正を要求しました。' };
	},

	finalizeScore: async ({ request, params, locals: { supabase }, url }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		const guestIdentifier = url.searchParams.get('guest');

		// ゲストユーザーの認証
		if (!user && guestIdentifier) {
			const { data: guestData, error: guestError } = await supabase
				.from('session_participants')
				.select('*')
				.eq('guest_identifier', guestIdentifier)
				.eq('is_guest', true)
				.single();

			if (guestError || !guestData) {
				return fail(401, { error: 'ゲスト認証が必要です。' });
			}
		} else if (userError || !user) {
			throw redirect(303, '/login');
		}

		const { id: sessionId, modeType, eventId } = params;
		const formData = await request.formData();
		const bib = formData.get('bib') as string;

		if (!bib) {
			return fail(400, { error: 'ゼッケン番号が指定されていません。' });
		}

		// セッション情報を取得して権限をチェック
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id, exclude_extremes, max_score_diff, is_tournament_mode, mode')
			.eq('id', sessionId)
			.single();

		if (sessionError) {
			return fail(500, { error: 'セッション情報の取得に失敗しました。' });
		}

		const isChief = user ? user.id === sessionData.chief_judge_id : false;

		// 複数検定員モードの確認
		let isMultiJudge = false;
		if (modeType === 'training') {
			const { data: trainingSession } = await supabase
				.from('training_sessions')
				.select('is_multi_judge')
				.eq('session_id', sessionId)
				.maybeSingle();
			isMultiJudge = trainingSession?.is_multi_judge || false;
		} else if (modeType === 'tournament') {
			isMultiJudge = true;
		}

		// 複数検定員モードONの場合、主任検定員のみが確定できる
		if (!isChief && isMultiJudge) {
			return fail(403, { error: '得点を確定する権限がありません。' });
		}

		const isTrainingMode = modeType === 'training';

		// active_prompt_idをクリアして次の採点を受け付けられるようにする
		await supabase.from('sessions').update({ active_prompt_id: null }).eq('id', sessionId);

		// 研修モードの場合はスコア計算なしで完了画面へ
		if (isTrainingMode) {
			throw redirect(303, `/session/${sessionId}/score/training/${eventId}/complete?bib=${bib}`);
		}

		// 大会モードの場合はスコアを計算（合計点）
		const { data: eventInfo } = await supabase
			.from('custom_events')
			.select('*')
			.eq('id', eventId)
			.single();

		if (!eventInfo) {
			return fail(404, { error: '種目が見つかりません。' });
		}

		// 全ての得点を取得
		const { data: scores, error: scoresError } = await supabase
			.from('results')
			.select('score')
			.eq('session_id', sessionId)
			.eq('bib', parseInt(bib))
			.eq('discipline', eventInfo.discipline)
			.eq('level', eventInfo.level)
			.eq('event_name', eventInfo.event_name);

		if (scoresError) {
			return fail(500, { error: '得点の取得に失敗しました。' });
		}

		if (!scores || scores.length === 0) {
			return fail(400, { error: '採点結果がありません。' });
		}

		const scoreValues = scores.map((s) => parseFloat(s.score)).sort((a, b) => a - b);

		// 大会モードで点差制限が設定されている場合、点差をチェック
		const isTournamentMode = modeType === 'tournament' || sessionData.is_tournament_mode || sessionData.mode === 'tournament';
		if (isTournamentMode && sessionData.max_score_diff !== null && sessionData.max_score_diff !== undefined) {
			const maxScore = Math.max(...scoreValues);
			const minScore = Math.min(...scoreValues);
			const scoreDiff = Math.round(maxScore - minScore);

			if (scoreDiff > sessionData.max_score_diff) {
				return fail(400, {
					error: `点差が上限を超えています（${scoreDiff}点 > ${sessionData.max_score_diff}点）。再採点を指示してください。`
				});
			}
		}

		let finalScore = 0;

		if (sessionData.exclude_extremes && scoreValues.length >= 5) {
			// 5審3採: 最大・最小を除く3人の合計
			const middleScores = scoreValues.slice(1, 4);
			finalScore = middleScores.reduce((acc, s) => acc + s, 0);
		} else {
			// 3審3採: 3人の合計
			finalScore = scoreValues.reduce((acc, s) => acc + s, 0);
		}

		// 完了画面へリダイレクト
		throw redirect(
			303,
			`/session/${sessionId}/score/tournament/${eventId}/complete?bib=${bib}&score=${finalScore}`
		);
	}
};
