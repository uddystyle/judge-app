import { error, redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	const { id: sessionId, modeType, eventId } = params;
	const bibNumber = url.searchParams.get('bib');
	const participantId = url.searchParams.get('participantId');
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

	if (!bibNumber || !participantId) {
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}` : '';
		throw redirect(303, `/session/${sessionId}/score/${modeType}/${eventId}${guestParam}`);
	}

	// セッション情報、参加者情報を並列取得（高速化）
	const [sessionResult, participantResult] = await Promise.all([
		supabase.from('sessions').select('*').eq('id', sessionId).single(),
		supabase.from('participants').select('*').eq('id', participantId).single()
	]);

	if (sessionResult.error) {
		throw error(404, '検定が見つかりません。');
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

		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		console.log('[submitScore] User check:', { hasUser: !!user, userError });

		const guestIdentifier = url.searchParams.get('guest');
		console.log('[submitScore] Guest identifier from URL:', guestIdentifier);

		// ゲストユーザーの認証
		let guestParticipant = null;
		if (!user && guestIdentifier) {
			console.log('[submitScore] Checking guest authentication...');
			const { data: guestData, error: guestError } = await supabase
				.from('session_participants')
				.select('*')
				.eq('guest_identifier', guestIdentifier)
				.eq('is_guest', true)
				.single();

			console.log('[submitScore] Guest data:', guestData);
			console.log('[submitScore] Guest error:', guestError);

			if (guestError || !guestData) {
				console.error('[submitScore] Guest authentication failed');
				return fail(401, { error: 'ゲスト認証が必要です。' });
			}

			guestParticipant = guestData;
			console.log('[submitScore] Guest authenticated:', guestParticipant.guest_name);
		} else if (userError || !user) {
			console.error('[submitScore] No user and no valid guest identifier');
			return fail(401, { error: '認証が必要です。' });
		}

		const formData = await request.formData();
		const score = parseFloat(formData.get('score') as string);
		const participantId = formData.get('participantId') as string;
		const bibNumber = parseInt(formData.get('bibNumber') as string);

		const { id: sessionId, modeType, eventId } = params;
		const sessionIdInt = parseInt(sessionId);

		console.log('[submitScore] Score submission:', {
			score,
			bibNumber,
			sessionId: sessionIdInt,
			modeType,
			eventId,
			hasUser: !!user,
			hasGuest: !!guestParticipant,
			guestName: guestParticipant?.guest_name
		});

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
