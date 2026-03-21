import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { authenticateSession, authenticateAction } from '$lib/server/sessionAuth';
import {
	fetchSessionDetails,
	fetchUserProfile,
	getMultiJudgeMode,
	fetchEventInfo,
	isChiefJudge,
	isTrainingModeCheck
} from '$lib/server/sessionHelpers';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const { id: sessionId, modeType, eventId } = params;
	const bib = url.searchParams.get('bib');
	const score = url.searchParams.get('score');
	const guestIdentifier = url.searchParams.get('guest');

	// セッション認証
	const { user, guestParticipant } = await authenticateSession(
		supabase,
		sessionId,
		guestIdentifier
	);

	if (!bib) {
		throw redirect(303, `/session/${sessionId}/score/${modeType}/${eventId}`);
	}

	const sessionDetails = await fetchSessionDetails(supabase, sessionId);
	const isChief = isChiefJudge(user, sessionDetails);
	const isTrainingMode = isTrainingModeCheck(modeType, sessionDetails);
	const profile = await fetchUserProfile(supabase, user);
	const isMultiJudge = await getMultiJudgeMode(supabase, sessionId, modeType, sessionDetails);
	const eventInfo = await fetchEventInfo(supabase, eventId, sessionId, isTrainingMode);

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
		guestIdentifier,
		profile
	};
};

export const actions: Actions = {
	endSession: async ({ params, url, locals: { supabase } }) => {
		const { id: sessionId, modeType } = params;
		const guestIdentifier = url.searchParams.get('guest');

		// セッション認証
		const authResult = await authenticateAction(supabase, sessionId, guestIdentifier);

		if (!authResult) {
			return { success: false, error: '認証が必要です。' };
		}

		const { user, guestParticipant } = authResult;

		// セッション情報を取得して権限確認
		const sessionDetails = await fetchSessionDetails(supabase, sessionId, { throwOnError: false });
		if (!sessionDetails) {
			return { success: false, error: '検定が見つかりません。' };
		}
		const isChief = isChiefJudge(user, sessionDetails);
		const isMultiJudge = await getMultiJudgeMode(supabase, sessionId, modeType, sessionDetails);

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
		const { id: sessionId, modeType } = params;
		const guestIdentifier = url.searchParams.get('guest');

		// セッション認証
		const authResult = await authenticateAction(supabase, sessionId, guestIdentifier);

		if (!authResult) {
			return { success: false, error: '認証が必要です。' };
		}

		const { user, guestParticipant } = authResult;

		// セッション情報を取得して権限確認
		const sessionDetails = await fetchSessionDetails(supabase, sessionId, { throwOnError: false });
		if (!sessionDetails) {
			return { success: false, error: '検定が見つかりません。' };
		}
		const isChief = isChiefJudge(user, sessionDetails);
		const isMultiJudge = await getMultiJudgeMode(supabase, sessionId, modeType, sessionDetails);

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
