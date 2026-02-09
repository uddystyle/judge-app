import { error, redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { authenticateSession, authenticateAction } from '$lib/server/sessionAuth';

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
	const [sessionResult, participantResult] = await Promise.all([
		supabase.from('sessions').select('*').eq('id', sessionId).single(),
		supabase
			.from('participants')
			.select('*')
			.eq('id', participantId)
			.eq('session_id', sessionId)
			.single()
	]);

	if (sessionResult.error) {
		throw error(404, '検定が見つかりません。');
	}

	if (participantResult.error) {
		console.error('[load] 参加者取得エラー:', participantResult.error);
		throw error(404, '参加者が見つかりません。このセッションに所属していない可能性があります。');
	}

	const sessionDetails = sessionResult.data;
	const participant = participantResult.data;

	// モード判定
	const isTrainingMode = modeType === 'training' || sessionDetails.mode === 'training';

	// モードに応じて種目情報とトレーニングセッション情報を並列取得
	let eventInfo: any = null;
	let isMultiJudge = false;

	if (isTrainingMode) {
		const [eventResult, trainingSessionResult] = await Promise.all([
			supabase
				.from('training_events')
				.select('*')
				.eq('id', eventId)
				.eq('session_id', sessionId)
				.single(),
			supabase
				.from('training_sessions')
				.select('is_multi_judge')
				.eq('session_id', sessionId)
				.maybeSingle()
		]);

		if (eventResult.error) {
			throw error(404, '種目が見つかりません。');
		}
		eventInfo = eventResult.data;
		isMultiJudge = trainingSessionResult.data?.is_multi_judge || false;
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

		if (modeType === 'tournament') {
			// 大会モードは常に複数検定員モードON
			isMultiJudge = true;
		} else {
			isMultiJudge = sessionDetails.is_multi_judge || false;
		}
	}

	const isChief = user ? user.id === sessionDetails.chief_judge_id : false;

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

		// 2. bibNumber のバリデーション（部分パース防止 + NaN チェック）
		// 正規表現で文字列全体が正の整数かチェック
		if (!bibNumberRaw || !/^\d+$/.test(bibNumberRaw.trim())) {
			console.error('[submitScore] bibNumber が不正な形式:', bibNumberRaw);
			return fail(400, { error: 'ゼッケン番号は正の整数で入力してください。' });
		}

		const bibNumber = Number(bibNumberRaw);

		if (isNaN(bibNumber) || bibNumber <= 0 || !Number.isInteger(bibNumber)) {
			console.error('[submitScore] bibNumber が無効:', bibNumber);
			return fail(400, { error: 'ゼッケン番号は正の整数である必要があります。' });
		}

		// 3. score のバリデーション（部分パース防止 + NaN・Infinity・整数チェック）
		// 正規表現で文字列全体が数値（整数または小数）かチェック
		if (!scoreRaw || !/^-?\d+(\.\d+)?$/.test(scoreRaw.trim())) {
			console.error('[submitScore] score が不正な形式:', scoreRaw);
			return fail(400, { error: '得点は数値で入力してください。' });
		}

		const score = Number(scoreRaw);

		if (isNaN(score)) {
			console.error('[submitScore] score が NaN です');
			return fail(400, { error: '得点は数値で入力してください。' });
		}

		if (!isFinite(score)) {
			console.error('[submitScore] score が無限大です:', score);
			return fail(400, { error: '得点が無効です。' });
		}

		// UI仕様が整数前提なので整数チェック
		if (!Number.isInteger(score)) {
			console.error('[submitScore] score が整数ではありません:', score);
			return fail(400, { error: '得点は整数で入力してください。' });
		}

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
		if (score < minScore || score > maxScore) {
			console.error('[submitScore] 得点範囲外:', { score, minScore, maxScore });
			return fail(400, {
				error: `得点は${minScore}～${maxScore}の範囲で入力してください。`
			});
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
			let judgeName: string;
			if (guestParticipant) {
				judgeName = guestParticipant.guest_name;
				console.log('[submitScore] Using guest name:', judgeName);
			} else if (user) {
				const { data: profile } = await supabase
					.from('profiles')
					.select('full_name')
					.eq('id', user.id)
					.single();
				judgeName = profile?.full_name || user.email || 'Unknown';
				console.log('[submitScore] Using user name:', judgeName);
			} else {
				console.error('[submitScore] Neither user nor guest found!');
				return fail(401, { error: '認証が必要です。' });
			}

			console.log('[submitScore] Inserting result:', {
				session_id: sessionIdInt,
				bib: bibNumber,
				score,
				judge_name: judgeName,
				discipline: eventData.discipline,
				level: eventData.level,
				event_name: eventData.event_name
			});

			const { error: insertError } = await supabase.from('results').upsert(
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

			if (insertError) {
				console.error('[submitScore] Error saving tournament score:', insertError);
				console.error('[submitScore] Error details:', {
					code: insertError.code,
					message: insertError.message,
					details: insertError.details,
					hint: insertError.hint
				});
				return fail(500, { error: `採点の保存に失敗しました。${insertError.message || ''}` });
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
