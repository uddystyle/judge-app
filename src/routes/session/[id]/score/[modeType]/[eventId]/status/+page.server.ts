import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { authenticateSession, authenticateAction } from '$lib/server/sessionAuth';
import {
	fetchSessionDetails,
	fetchUserProfile,
	getMultiJudgeMode,
	fetchEventInfo,
	isChiefJudge,
	isTrainingModeCheck,
	isTournamentModeCheck
} from '$lib/server/sessionHelpers';
import { calculateFinalScore } from '$lib/scoreCalculation';
import { deleteTrainingScore } from '$lib/server/scoreActions';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const { id: sessionId, modeType, eventId } = params;
	const guestIdentifier = url.searchParams.get('guest');
	const bib = url.searchParams.get('bib');

	// セッション認証
	const { user, guestParticipant } = await authenticateSession(
		supabase,
		sessionId,
		guestIdentifier
	);

	const sessionDetails = await fetchSessionDetails(supabase, sessionId);
	const isChief = isChiefJudge(user, sessionDetails);
	const isTrainingMode = isTrainingModeCheck(modeType, sessionDetails);
	const isTournamentMode = isTournamentModeCheck(modeType, sessionDetails);
	const profile = await fetchUserProfile(supabase, user);
	const isMultiJudge = await getMultiJudgeMode(supabase, sessionId, modeType, sessionDetails);
	const eventInfo = await fetchEventInfo(supabase, eventId, sessionId, isTrainingMode);

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

	// 初期スコアデータを取得
	let initialScoreStatus: { scores: any[]; requiredJudges: number } = { scores: [], requiredJudges: 1 };
	let athleteId: string | null = null;

	if (bib) {
		if (isTrainingMode) {
			// 研修モード: participants → training_scores → profiles/session_participants
			const { data: participant } = await supabase
				.from('participants')
				.select('id')
				.eq('session_id', sessionId)
				.eq('bib_number', parseInt(bib))
				.maybeSingle();

			if (participant) {
				athleteId = participant.id;

				const { data: trainingScores } = await supabase
					.from('training_scores')
					.select('id, score, judge_id, guest_identifier')
					.eq('event_id', eventId)
					.eq('athlete_id', participant.id);

				if (trainingScores && trainingScores.length > 0) {
					// 検定員名をバッチ取得
					const judgeIds = trainingScores
						.filter((s) => s.judge_id)
						.map((s) => s.judge_id);
					const guestIdentifiers = trainingScores
						.filter((s) => s.guest_identifier)
						.map((s) => s.guest_identifier);

					let judgeNames: Record<string, string> = {};
					if (judgeIds.length > 0) {
						const { data: profiles } = await supabase
							.from('profiles')
							.select('id, full_name')
							.in('id', judgeIds);
						if (profiles) {
							judgeNames = Object.fromEntries(
								profiles.map((p) => [p.id, p.full_name || '不明'])
							);
						}
					}

					let guestNames: Record<string, string> = {};
					if (guestIdentifiers.length > 0) {
						const { data: guests } = await supabase
							.from('session_participants')
							.select('guest_identifier, guest_name')
							.in('guest_identifier', guestIdentifiers);
						if (guests) {
							guestNames = Object.fromEntries(
								guests.map((g) => [g.guest_identifier, g.guest_name || 'ゲスト'])
							);
						}
					}

					const scoresWithNames = trainingScores.map((s) => ({
						judge_id: s.judge_id,
						guest_identifier: s.guest_identifier,
						judge_name: s.guest_identifier
							? guestNames[s.guest_identifier] || 'ゲスト'
							: judgeNames[s.judge_id] || '不明',
						score: s.score,
						is_guest: !!s.guest_identifier
					}));

					initialScoreStatus = {
						scores: scoresWithNames,
						requiredJudges: totalJudges
					};
				} else {
					initialScoreStatus = { scores: [], requiredJudges: totalJudges };
				}
			}
		} else {
			// 大会モード: results テーブルから取得
			const { data: scores } = await supabase
				.from('results')
				.select('judge_name, score')
				.eq('session_id', sessionId)
				.eq('bib', parseInt(bib))
				.eq('discipline', eventInfo.discipline)
				.eq('level', eventInfo.level)
				.eq('event_name', eventInfo.event_name);

			const requiredJudges = sessionDetails.exclude_extremes ? 5 : 3;
			initialScoreStatus = {
				scores: scores || [],
				requiredJudges
			};
		}
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
		profile,
		initialScoreStatus,
		athleteId
	};
};

export const actions: Actions = {
	requestCorrection: async ({ request, params, locals: { supabase }, url }) => {
		const guestIdentifier = url.searchParams.get('guest');

		// セッション認証
		const authResult = await authenticateAction(supabase, params.id, guestIdentifier);

		if (!authResult) {
			return fail(401, { error: '認証が必要です。' });
		}

		const { user } = authResult;

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
		const sessionData = await fetchSessionDetails(supabase, sessionId, { throwOnError: false });
		if (!sessionData) {
			return fail(500, { error: 'セッション情報の取得に失敗しました。' });
		}
		const isChief = isChiefJudge(user, sessionData);
		const isMultiJudge = await getMultiJudgeMode(supabase, sessionId, modeType, sessionData);

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
			const deleteResult = await deleteTrainingScore(supabase, {
				eventId,
				athleteId: participant.id,
				guestIdentifier: formGuestIdentifier || null,
				judgeId: judgeId || null,
				judgeName
			});

			if (!deleteResult.success) {
				return fail(500, { error: deleteResult.error });
			}
		} else {
			// 大会モードの場合、resultsから削除
			const { data: eventInfo } = await supabase
				.from('custom_events')
				.select('*')
				.eq('id', eventId)
				.eq('session_id', sessionId)
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
		const guestIdentifier = url.searchParams.get('guest');

		// セッション認証
		const authResult = await authenticateAction(supabase, params.id, guestIdentifier);

		if (!authResult) {
			return fail(401, { error: '認証が必要です。' });
		}

		const { user } = authResult;

		const { id: sessionId, modeType, eventId } = params;
		const formData = await request.formData();
		const bib = formData.get('bib') as string;

		if (!bib) {
			return fail(400, { error: 'ゼッケン番号が指定されていません。' });
		}

		// セッション情報を取得して権限をチェック
		const sessionData = await fetchSessionDetails(supabase, sessionId);
		const isChief = isChiefJudge(user, sessionData);
		const isMultiJudge = await getMultiJudgeMode(supabase, sessionId, modeType, sessionData);

		// 複数検定員モードONの場合、主任検定員のみが確定できる
		if (!isChief && isMultiJudge) {
			return fail(403, { error: '得点を確定する権限がありません。' });
		}

		const isTrainingMode = modeType === 'training';

		// active_prompt_idをクリアして次の採点を受け付けられるようにする
		await supabase.from('sessions').update({ active_prompt_id: null }).eq('id', sessionId);

		// 研修モードの場合はスコア計算なしで完了画面へ
		if (isTrainingMode) {
			const guestParam = guestIdentifier ? `&guest=${guestIdentifier}` : '';
			throw redirect(303, `/session/${sessionId}/score/training/${eventId}/complete?bib=${bib}${guestParam}`);
		}

		// 大会モードの場合はスコアを計算（合計点）
		const { data: eventInfo } = await supabase
			.from('custom_events')
			.select('*')
			.eq('id', eventId)
			.eq('session_id', sessionId)
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

		const scoreValues = scores.map((s) => parseFloat(s.score));

		const calcResult = calculateFinalScore(scoreValues, {
			useSum: true,
			excludeExtremes: sessionData.exclude_extremes || false,
			maxScoreDiff: sessionData.max_score_diff ?? null
		});

		if (!calcResult.success) {
			return fail(400, { error: calcResult.error });
		}

		const finalScore = calcResult.finalScore;

		// 完了画面へリダイレクト（ゲストパラメータを保持）
		const guestParam = guestIdentifier ? `&guest=${guestIdentifier}` : '';
		throw redirect(
			303,
			`/session/${sessionId}/score/tournament/${eventId}/complete?bib=${bib}&score=${finalScore}${guestParam}`
		);
	}
};
