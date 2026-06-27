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
	getJudgeName,
	fetchActivePrompt
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

	if (!bibNumber) {
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}` : '';
		throw redirect(303, `/session/${sessionId}/score/${modeType}/${eventId}${guestParam}`);
	}

	// participantId が無い場合は bib から解決する
	// (#6: navigationMonitor の bib のみフォールバック遷移でも input に着地できるようにする)
	let resolvedParticipantId = participantId;
	if (!resolvedParticipantId) {
		const { data: bibParticipant } = await supabase
			.from('participants')
			.select('id')
			.eq('session_id', sessionId)
			.eq('bib_number', parseInt(bibNumber))
			.maybeSingle();
		if (!bibParticipant) {
			const guestParam = guestIdentifier ? `?guest=${guestIdentifier}` : '';
			throw redirect(303, `/session/${sessionId}/score/${modeType}/${eventId}${guestParam}`);
		}
		resolvedParticipantId = bibParticipant.id;
	}

	// セッション情報、参加者情報を並列取得（高速化）
	const [sessionDetails, participantResult] = await Promise.all([
		fetchSessionDetails(supabase, sessionId),
		supabase
			.from('participants')
			.select('*')
			.eq('id', resolvedParticipantId)
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

	// 種目が見つからない/RLSで不可視の場合は 404 を返す（participant ガードと対称）。
	// これがないと +page.svelte が data.eventInfo.* を参照して 500 クラッシュする。
	if (!eventInfo) {
		throw error(404, '種目が見つかりません。');
	}

	// #4: 複数審判モードでは、非主任・非ゲストの審判は主任が指定した active prompt の bib のみ採点できる。
	// 直URLで任意の bib を開いて採点することを防ぐ（主任・ゲストは従来どおり制約しない）。
	if (isMultiJudge && !isChief && !guestParticipant) {
		const activePrompt = await fetchActivePrompt(supabase, sessionId);
		const bibAllowed =
			!!activePrompt &&
			activePrompt.bib_number === parseInt(bibNumber) &&
			String(activePrompt.level) === String(eventId);
		if (!bibAllowed) {
			throw redirect(303, `/session/${sessionId}`);
		}
	}

	return {
		sessionDetails,
		eventInfo,
		participant,
		bibNumber: parseInt(bibNumber),
		participantId: resolvedParticipantId,
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

		const guestIdentifier = url.searchParams.get('guest');

		// セッション認証
		const authResult = await authenticateAction(supabase, params.id, guestIdentifier);

		if (!authResult) {
			console.error('[submitScore] Authentication failed');
			return fail(401, { error: '認証が必要です。' });
		}

		const { user, guestParticipant } = authResult;
		console.log('[submitScore] User check:', { hasUser: !!user, hasGuest: !!guestParticipant });

		const formData = await request.formData();
		const participantId = formData.get('participantId') as string;
		const scoreRaw = formData.get('score') as string;
		const bibNumberRaw = formData.get('bibNumber') as string;

		const { id: sessionId, modeType, eventId } = params;
		const sessionIdInt = parseInt(sessionId);

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

		// 4.5. #4: 複数審判モードでは、非主任・非ゲストの審判は主任が指定した bib のみ採点できる
		{
			const submitSessionDetails = await fetchSessionDetails(supabase, sessionId);
			const submitIsChief = isChiefJudge(user, submitSessionDetails);
			const submitIsMultiJudge = await getMultiJudgeMode(
				supabase,
				sessionId,
				modeType,
				submitSessionDetails
			);
			if (submitIsMultiJudge && !submitIsChief && !guestParticipant) {
				const activePrompt = await fetchActivePrompt(supabase, sessionId);
				if (
					!activePrompt ||
					activePrompt.bib_number !== bibNumber ||
					String(activePrompt.level) !== String(eventId)
				) {
					console.error('[submitScore] 主任指定外の bib への採点を拒否:', { bibNumber, eventId });
					return fail(403, { error: '主任検定員が指定した選手のみ採点できます。' });
				}
			}
		}

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
				// 生のURL値ではなく JWT 検証済みの guest_identifier を使う（同セッション内での
				// スコア偽造・上書きをアプリ側で防ぐ。RLS(1001)だけに依存しない）
				existingScoreQuery = existingScoreQuery.eq(
					'guest_identifier',
					guestParticipant.guest_identifier
				);
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
					// ゲストユーザーの場合: JWT 検証済みの guest_identifier を使う（生のURL値は使わない）
					scoreData.guest_identifier = guestParticipant.guest_identifier;
					console.log('[submitScore] Inserting training score for guest');
				} else {
					// 認証ユーザーの場合
					scoreData.judge_id = user.id;
					console.log('[submitScore] Inserting training score for user');
				}

				const { error: insertErr } = await supabase.from('training_scores').insert(scoreData);
				if (insertErr && insertErr.code === '23505') {
					// #1: 同一審判の並行重複（部分ユニーク索引違反）。既存行を UPDATE して最新 score を
					// 確定し、500 を返さない（1件目の INSERT は既に成功＝得点は保存済み）。
					let dupUpdate = supabase
						.from('training_scores')
						.update({ score: score, is_finalized: true, updated_at: new Date().toISOString() })
						.eq('event_id', eventId)
						.eq('athlete_id', participantId);
					dupUpdate = guestParticipant
						? dupUpdate.eq('guest_identifier', guestParticipant.guest_identifier)
						: dupUpdate.eq('judge_id', user!.id);
					const { error: dupErr } = await dupUpdate;
					saveError = dupErr;
				} else {
					saveError = insertErr;
				}
			}

			if (saveError) {
				console.error('[submitScore] Error saving training score:', saveError);
				return fail(500, { error: '採点の保存に失敗しました。時間をおいて再度お試しください。' });
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
			// results.judge_name は素の guest_name を保存する。RLS(1000/1001) は judge_name = 素の
			// guest_name 一致を要求するため、"(ゲスト)" 接尾辞を付けると保存が拒否される（可用性バグ）。
			// 接尾辞が必要なら表示時に付与する。
			const judgeName = await getJudgeName(supabase, user, guestParticipant);
			if (!judgeName) {
				console.error('[submitScore] Neither user nor guest found!');
				return fail(401, { error: '認証が必要です。' });
			}
			// #7: owner（認証=judge_id / ゲスト=guest_identifier）で識別する。
			// owner が異なる審判同士は別行（部分一意索引 results_unique_owner_*）なので相互に上書きしない。
			// 自分の owner の既存行を SELECT → UPDATE by id / 無ければ INSERT。
			// 23505 は「自分の owner の並行重複」なら UPDATE で吸収。owner 行が無ければ phase1 の旧 name-unique
			// 衝突（同名・別 owner）なので明示的に 409 を返す（phase2 適用後は name-unique が無くなり起きない）。
			const ownerColumn = guestParticipant ? 'guest_identifier' : 'judge_id';
			const ownerValue = guestParticipant ? guestParticipant.guest_identifier : user!.id;

			const { data: existingResult } = await supabase
				.from('results')
				.select('id')
				.eq('session_id', sessionIdInt)
				.eq('bib', bibNumber)
				.eq('discipline', eventData.discipline)
				.eq('level', eventData.level)
				.eq('event_name', eventData.event_name)
				.eq(ownerColumn, ownerValue)
				.maybeSingle();

			let resultSaveError: { message?: string } | null = null;
			let nameCollision = false;

			if (existingResult) {
				const { error } = await supabase
					.from('results')
					.update({ score: score, judge_name: judgeName })
					.eq('id', existingResult.id);
				resultSaveError = error;
			} else {
				const resultData: Record<string, unknown> = {
					session_id: sessionIdInt,
					bib: bibNumber,
					score: score,
					judge_name: judgeName,
					discipline: eventData.discipline,
					level: eventData.level,
					event_name: eventData.event_name
				};
				resultData[ownerColumn] = ownerValue;

				const { error: insErr } = await supabase.from('results').insert(resultData);
				if (insErr && insErr.code === '23505') {
					const { data: upd, error: updErr } = await supabase
						.from('results')
						.update({ score: score, judge_name: judgeName })
						.eq('session_id', sessionIdInt)
						.eq('bib', bibNumber)
						.eq('discipline', eventData.discipline)
						.eq('level', eventData.level)
						.eq('event_name', eventData.event_name)
						.eq(ownerColumn, ownerValue)
						.select('id');
					if (updErr) {
						resultSaveError = updErr;
					} else if (!upd || upd.length === 0) {
						// 自分の owner 行は無いのに 23505 ＝ 同名・別 owner の旧 name-unique 衝突（phase1 のみ）
						nameCollision = true;
					}
				} else {
					resultSaveError = insErr;
				}
			}

			if (nameCollision) {
				return fail(409, {
					error: 'この名前は既にこの検定で使われています。別の名前で参加し直してください。'
				});
			}
			if (resultSaveError) {
				console.error('[submitScore] Error saving tournament score:', resultSaveError);
				return fail(500, { error: '採点の保存に失敗しました。時間をおいて再度お試しください。' });
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
