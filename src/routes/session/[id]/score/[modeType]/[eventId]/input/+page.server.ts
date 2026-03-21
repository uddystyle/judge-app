import { error, redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { authenticateSession, authenticateAction } from '$lib/server/sessionAuth';
import {
	fetchSessionDetails,
	fetchUserProfile,
	getMultiJudgeMode,
	fetchEventInfo,
	isChiefJudge,
	isTrainingModeCheck,
	getJudgeName
} from '$lib/server/sessionHelpers';
import { validateBib, validateScoreInput, validateScoreRange } from '$lib/server/validation';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const { id: sessionId, modeType, eventId } = params;
	const bibNumber = url.searchParams.get('bib');
	const participantId = url.searchParams.get('participantId');
	const guestIdentifier = url.searchParams.get('guest');

	// セッション認証
	const { user, guestParticipant } = await authenticateSession(
		supabase,
		sessionId,
		guestIdentifier
	);

	if (!bibNumber || !participantId) {
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}` : '';
		throw redirect(303, `/session/${sessionId}/score/${modeType}/${eventId}${guestParam}`);
	}

	// セッション情報、参加者情報を並列取得（高速化）
	const [sessionDetails, participantResult] = await Promise.all([
		fetchSessionDetails(supabase, sessionId),
		supabase
			.from('participants')
			.select('*')
			.eq('id', participantId)
			.eq('session_id', sessionId)
			.single()
	]);

	if (participantResult.error) {
		console.error('[load] 参加者取得エラー:', participantResult.error);
		throw error(404, '参加者が見つかりません。このセッションに所属していない可能性があります。');
	}

	const participant = participantResult.data;
	const isTrainingMode = isTrainingModeCheck(modeType, sessionDetails);
	const [eventInfo, isMultiJudge, isChief, profile] = await Promise.all([
		fetchEventInfo(supabase, eventId, sessionId, isTrainingMode),
		getMultiJudgeMode(supabase, sessionId, modeType, sessionDetails),
		Promise.resolve(isChiefJudge(user, sessionDetails)),
		fetchUserProfile(supabase, user)
	]);

	return {
		sessionDetails,
		eventInfo,
		participant,
		bibNumber: parseInt(bibNumber),
		participantId,
		isTrainingMode,
		isMultiJudge,
		isChief,
		guestParticipant,
		guestIdentifier,
		user,
		profile
	};
};

export const actions: Actions = {
	submitScore: async ({ request, params, url, locals: { supabase } }) => {
		console.log('[submitScore] Action called');
		console.log('[submitScore] URL:', url.toString());
		console.log('[submitScore] URL search params:', Object.fromEntries(url.searchParams));

		const guestIdentifier = url.searchParams.get('guest');
		console.log('[submitScore] Guest identifier from URL:', guestIdentifier);

		// セッション認証
		const authResult = await authenticateAction(supabase, params.id, guestIdentifier);

		if (!authResult) {
			console.error('[submitScore] Authentication failed');
			return fail(401, { error: '認証が必要です。' });
		}

		const { user, guestParticipant } = authResult;
		console.log('[submitScore] User check:', { hasUser: !!user, hasGuest: !!guestParticipant });

		if (guestParticipant) {
			console.log('[submitScore] Guest authenticated:', guestParticipant.guest_name);
		}

		const formData = await request.formData();
		const participantId = formData.get('participantId') as string;
		const scoreRaw = formData.get('score') as string;
		const bibNumberRaw = formData.get('bibNumber') as string;

		const { id: sessionId, modeType, eventId } = params;
		const sessionIdInt = parseInt(sessionId);

		console.log('[submitScore] Score submission (raw):', {
			scoreRaw,
			bibNumberRaw,
			participantId,
			sessionId: sessionIdInt,
			modeType,
			eventId,
			hasUser: !!user,
			hasGuest: !!guestParticipant,
			guestName: guestParticipant?.guest_name
		});

		// ============================================================
		// バリデーション
		// ============================================================

		// 1. participantId のバリデーション
		if (!participantId || participantId.trim() === '') {
			console.error('[submitScore] participantId が空です');
			return fail(400, { error: '参加者IDが指定されていません。' });
		}

		// 2. bibNumber のバリデーション
		const bibResult = validateBib(bibNumberRaw);
		if (!bibResult.success) {
			console.error('[submitScore] bibNumber が不正:', bibNumberRaw);
			return fail(400, { error: bibResult.error });
		}
		const bibNumber = bibResult.value;

		// 3. score のバリデーション
		const scoreResult = validateScoreInput(scoreRaw);
		if (!scoreResult.success) {
			console.error('[submitScore] score が不正:', scoreRaw);
			return fail(400, { error: scoreResult.error });
		}
		const score = scoreResult.value;

		// 4. bibNumber と participantId の整合性チェック
		const { data: participant, error: participantError } = await supabase
			.from('participants')
			.select('id, bib_number')
			.eq('session_id', sessionId)
			.eq('id', participantId)
			.eq('bib_number', bibNumber)
			.single();

		if (participantError || !participant) {
			console.error('[submitScore] participantId と bibNumber の整合性エラー:', {
				participantId,
				bibNumber,
				error: participantError
			});
			return fail(400, {
				error: 'ゼッケン番号と参加者IDが一致しません。不正なリクエストの可能性があります。'
			});
		}

		console.log('[submitScore] 参加者確認成功:', participant);

		// 5. イベント情報を取得して得点範囲をチェック
		let minScore = 0;
		let maxScore = 100;

		if (modeType === 'training') {
			// 研修モード: training_events から範囲を取得
			const { data: eventData, error: eventError } = await supabase
				.from('training_events')
				.select('min_score, max_score')
				.eq('id', eventId)
				.eq('session_id', sessionId)
				.single();

			if (eventError || !eventData) {
				console.error('[submitScore] training_events の取得エラー:', eventError);
				return fail(404, { error: '種目情報が見つかりません。' });
			}

			minScore = eventData.min_score || 0;
			maxScore = eventData.max_score || 100;
		} else {
			// 大会モード: custom_events を確認（範囲設定がないため 0-100 を使用）
			const { data: eventData, error: eventError } = await supabase
				.from('custom_events')
				.select('id')
				.eq('id', eventId)
				.eq('session_id', sessionId)
				.single();

			if (eventError || !eventData) {
				console.error('[submitScore] custom_events の取得エラー:', eventError);
				return fail(404, { error: '種目情報が見つかりません。' });
			}

			// 大会モードは 0-100 の固定範囲
			minScore = 0;
			maxScore = 100;
		}

		// 6. 得点範囲チェック
		const rangeResult = validateScoreRange(score, minScore, maxScore);
		if (!rangeResult.success) {
			console.error('[submitScore] 得点範囲外:', { score, minScore, maxScore });
			return fail(400, { error: rangeResult.error });
		}

		console.log('[submitScore] バリデーション完了。得点を保存します。');

		// 得点をデータベースに保存
		if (modeType === 'training') {
			// 既存のスコアを確認（認証ユーザーまたはゲスト）
			let existingScoreQuery = supabase
				.from('training_scores')
				.select('id')
				.eq('event_id', eventId)
				.eq('athlete_id', participantId);

			if (guestParticipant) {
				// ゲストユーザーの場合
				existingScoreQuery = existingScoreQuery.eq('guest_identifier', guestIdentifier);
			} else {
				// 認証ユーザーの場合
				existingScoreQuery = existingScoreQuery.eq('judge_id', user.id);
			}

			const { data: existingScore } = await existingScoreQuery.maybeSingle();

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
				const scoreData: any = {
					event_id: eventId,
					athlete_id: participantId,
					score: score,
					is_finalized: true
				};

				if (guestParticipant) {
					// ゲストユーザーの場合
					scoreData.guest_identifier = guestIdentifier;
					console.log('[submitScore] Inserting training score for guest:', guestIdentifier);
				} else {
					// 認証ユーザーの場合
					scoreData.judge_id = user.id;
					console.log('[submitScore] Inserting training score for user:', user.id);
				}

				const { error } = await supabase.from('training_scores').insert(scoreData);
				saveError = error;
			}

			if (saveError) {
				console.error('[submitScore] Error saving training score:', saveError);
				return fail(500, { error: `採点の保存に失敗しました。${saveError.message || ''}` });
			}
		} else {
			// 大会モード - resultsテーブルに保存
			const { data: eventData } = await supabase
				.from('custom_events')
				.select('*')
				.eq('id', eventId)
				.eq('session_id', sessionId)
				.single();

			if (!eventData) {
				return fail(404, { error: '種目が見つかりません。' });
			}

			// 検定員名を取得（通常ユーザーまたはゲストユーザー）
			const judgeName = await getJudgeName(supabase, user, guestParticipant, { addGuestSuffix: true });
			if (!judgeName) {
				console.error('[submitScore] Neither user nor guest found!');
				return fail(401, { error: '認証が必要です。' });
			}
			console.log('[submitScore] Using judge name:', judgeName);

			console.log('[submitScore] Inserting result:', {
				session_id: sessionIdInt,
				bib: bibNumber,
				score,
				judge_name: judgeName,
				discipline: eventData.discipline,
				level: eventData.level,
				event_name: eventData.event_name
			});

			// 同時採点対応: Exponential backoff でリトライ
			const MAX_RETRIES = 3;
			let insertError = null;

			for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
				const { error } = await supabase.from('results').upsert(
					{
						session_id: sessionIdInt,
						bib: bibNumber,
						score: score,
						judge_name: judgeName,
						discipline: eventData.discipline,
						level: eventData.level,
						event_name: eventData.event_name
					},
					{
						onConflict: 'session_id, bib, discipline, level, event_name, judge_name'
					}
				);

				if (!error) {
					// 成功
					insertError = null;
					break;
				}

				// エラーコードをチェック
				const errorCode = error.code;
				const isRetryable =
					errorCode === '40001' || // SERIALIZATION FAILURE
					errorCode === '40P01'; // DEADLOCK DETECTED

				if (!isRetryable) {
					// リトライ不可能なエラー（例: 制約違反）は即座に失敗
					insertError = error;
					break;
				}

				// リトライ可能なエラー
				insertError = error;
				console.warn(
					`[submitScore] Retryable error (${errorCode}) on attempt ${attempt + 1}/${MAX_RETRIES}:`,
					error.message
				);

				if (attempt < MAX_RETRIES - 1) {
					// 最後の試行でない場合、exponential backoff
					const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 100, 1000);
					console.log(`[submitScore] Retrying in ${delay}ms...`);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}

			if (insertError) {
				console.error('[submitScore] Error saving tournament score:', insertError);
				console.error('[submitScore] Error details:', {
					code: insertError.code,
					message: insertError.message,
					details: insertError.details,
					hint: insertError.hint
				});
				return fail(500, {
					error: `採点の保存に失敗しました。${
						insertError.code === '40001' || insertError.code === '40P01'
							? '複数の検定員が同時に採点したため、再度お試しください。'
							: insertError.message || ''
					}`
				});
			}

			console.log('[submitScore] Score saved successfully');
		}

		return {
			success: true,
			score,
			bibNumber
		};
	}
};
