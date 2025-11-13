import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	const { id: sessionId, modeType, eventId } = params;
	const bib = url.searchParams.get('bib');
	const score = url.searchParams.get('score');
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

	const isChief = user ? user.id === sessionDetails.chief_judge_id : false;
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
				// judge_idまたはguest_identifierから名前を取得
				const scoresWithNames = await Promise.all(
					trainingScores.map(async (s: any) => {
						let judgeName = '不明';

						if (s.guest_identifier) {
							// ゲストユーザーの場合
							const { data: guestData } = await supabase
								.from('session_participants')
								.select('guest_name')
								.eq('guest_identifier', s.guest_identifier)
								.single();

							judgeName = guestData?.guest_name || 'ゲスト';
						} else if (s.judge_id) {
							// 認証ユーザーの場合
							const { data: profile } = await supabase
								.from('profiles')
								.select('full_name')
								.eq('id', s.judge_id)
								.single();

							judgeName = profile?.full_name || '不明';
						}

						return {
							judge_name: judgeName,
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
		isTrainingMode,
		user,
		guestParticipant,
		guestIdentifier
	};
};

export const actions: Actions = {
	endSession: async ({ params, url, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		const guestIdentifier = url.searchParams.get('guest');

		// ゲストユーザーの認証
		let guestParticipant = null;
		if (!user && guestIdentifier) {
			const { data: guestData, error: guestError } = await supabase
				.from('session_participants')
				.select('*')
				.eq('guest_identifier', guestIdentifier)
				.eq('is_guest', true)
				.single();

			if (guestError || !guestData) {
				return { success: false, error: 'ゲスト認証が必要です。' };
			}

			guestParticipant = guestData;
		} else if (userError || !user) {
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

		const isChief = user ? user.id === sessionDetails.chief_judge_id : false;
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

		// セッションを終了状態に更新
		// status を 'ended' に設定し、is_active と active_prompt_id をクリア
		console.log('[主任検定員] ========== セッション終了処理開始 ==========');
		console.log('[主任検定員] sessionId:', sessionId);
		console.log('[主任検定員] 更新内容: { status: "ended", is_active: false, active_prompt_id: null }');

		const { data: updateResult, error } = await supabase
			.from('sessions')
			.update({
				status: 'ended',
				is_active: false,
				active_prompt_id: null
			})
			.eq('id', sessionId)
			.select();

		console.log('[主任検定員] 更新結果:', { updateResult, error });

		if (error) {
			console.error('[主任検定員] ❌ Error ending session:', error);
			return { success: false, error: 'セッションの終了に失敗しました: ' + error.message };
		}

		console.log('[主任検定員] ✅ セッション終了の更新が完了しました', { sessionId });

		// 更新後の状態を確認
		const { data: verifyData, error: verifyError } = await supabase
			.from('sessions')
			.select('status, is_active, active_prompt_id')
			.eq('id', sessionId)
			.single();

		console.log('[主任検定員] 更新後の確認:', { verifyData, verifyError });

		// セッション詳細画面（終了画面）にリダイレクト
		const guestParam = guestIdentifier ? `&guest=${guestIdentifier}` : '';
		throw redirect(303, `/session/${sessionId}?ended=true${guestParam}`);
	},

	changeEvent: async ({ params, url, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		const guestIdentifier = url.searchParams.get('guest');

		// ゲストユーザーの認証
		let guestParticipant = null;
		if (!user && guestIdentifier) {
			const { data: guestData, error: guestError } = await supabase
				.from('session_participants')
				.select('*')
				.eq('guest_identifier', guestIdentifier)
				.eq('is_guest', true)
				.single();

			if (guestError || !guestData) {
				return { success: false, error: 'ゲスト認証が必要です。' };
			}

			guestParticipant = guestData;
		} else if (userError || !user) {
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

		const isChief = user ? user.id === sessionDetails.chief_judge_id : false;

		// 研修モードの場合、training_sessionsからis_multi_judgeを取得
		let isMultiJudge = false;
		if (modeType === 'training') {
			const { data: trainingSession } = await supabase
				.from('training_sessions')
				.select('is_multi_judge')
				.eq('session_id', sessionId)
				.maybeSingle();
			isMultiJudge = trainingSession?.is_multi_judge || false;
		} else {
			isMultiJudge = sessionDetails.is_multi_judge || false;
		}

		// 主任検定員または複数検定員モードOFFの場合のみ実行可能
		if (!isChief && isMultiJudge) {
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
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}` : '';
		const eventListUrl = modeType === 'training' ? `/session/${sessionId}/training-events${guestParam}` : `/session/${sessionId}/tournament-events${guestParam}`;
		throw redirect(303, eventListUrl);
	}
};
