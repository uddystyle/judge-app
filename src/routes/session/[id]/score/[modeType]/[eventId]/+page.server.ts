import { error, redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { authenticateSession, authenticateAction } from '$lib/server/sessionAuth';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const { id: sessionId, modeType, eventId } = params;
	const guestIdentifier = url.searchParams.get('guest');

	// セッション認証
	const { user, guestParticipant } = await authenticateSession(
		supabase,
		sessionId,
		guestIdentifier
	);

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
	if (modeType === 'training') {
		const { data: trainingSession } = await supabase
			.from('training_sessions')
			.select('is_multi_judge')
			.eq('session_id', sessionId)
			.maybeSingle();
		isMultiJudge = trainingSession?.is_multi_judge || false;
	} else if (modeType === 'tournament') {
		// 大会モードは常に複数検定員モードON（ただしゲストユーザーは採点可能）
		isMultiJudge = true;
	}

	// 複数検定員モードONの場合、主任検定員のみアクセス可能
	// ただし、ゲストユーザーは例外として採点可能
	if (isMultiJudge && !isChief && !guestParticipant) {
		throw redirect(303, `/session/${sessionId}`);
	}

	// モードに応じて種目情報を取得
	let eventInfo: any = null;
	let isTrainingMode = false;
	let isTournamentMode = false;

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
	} else if (modeType === 'tournament' || sessionDetails.is_tournament_mode) {
		isTournamentMode = true;
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

	if (!eventInfo) {
		throw error(404, '種目が見つかりません。');
	}

	// 研修モードの場合、セッション情報を取得
	let trainingSession = null;
	if (isTrainingMode) {
		const { data } = await supabase
			.from('training_sessions')
			.select('*')
			.eq('session_id', sessionId)
			.maybeSingle();
		trainingSession = data;
	}

	return {
		sessionDetails,
		eventInfo,
		trainingSession,
		isTrainingMode,
		isTournamentMode,
		isChief,
		isMultiJudge,
		excludeExtremes: sessionDetails.exclude_extremes || false,
		guestParticipant,
		guestIdentifier,
		user,
		profile
	};
};

export const actions: Actions = {
	submitBib: async ({ request, params, url, locals: { supabase } }) => {
		const guestIdentifier = url.searchParams.get('guest');

		// セッション認証
		const authResult = await authenticateAction(supabase, params.id, guestIdentifier);

		if (!authResult) {
			return fail(401, { error: '認証が必要です。' });
		}

		const { user, guestParticipant } = authResult;

		const { id: sessionId, modeType, eventId } = params;
		const sessionIdInt = parseInt(sessionId);

		// セッション情報を取得して権限をチェック
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id')
			.eq('id', sessionIdInt)
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
				.eq('session_id', sessionIdInt)
				.maybeSingle();
			isMultiJudge = trainingSession?.is_multi_judge || false;
		} else if (modeType === 'tournament') {
			isMultiJudge = true;
		}

		// 複数検定員モードONの場合、主任検定員のみがゼッケン番号を確定できる
		// ゲストユーザーは例外として許可
		if (!isChief && isMultiJudge && !guestParticipant) {
			return fail(403, { error: 'ゼッケン番号を確定する権限がありません。' });
		}

		const formData = await request.formData();
		const bibNumber = parseInt(formData.get('bibNumber') as string);

		if (isNaN(bibNumber) || bibNumber <= 0) {
			return fail(400, { error: 'ゼッケン番号は正の整数である必要があります。' });
		}

		// 同じゼッケン番号の参加者が既に存在するか確認
		const { data: existingParticipant, error: checkError } = await supabase
			.from('participants')
			.select('id')
			.eq('session_id', sessionIdInt)
			.eq('bib_number', bibNumber)
			.maybeSingle();

		if (checkError) {
			console.error('[submitBib] Error checking existing participant:', checkError);
		}

		let participantId: string;

		if (existingParticipant) {
			participantId = existingParticipant.id;
		} else {
			// 参加者レコードを新規作成
			console.log('[submitBib] Creating new participant:', {
				session_id: sessionIdInt,
				bib_number: bibNumber,
				athlete_name: `選手${bibNumber}`
			});

			const { data: newParticipant, error: createError } = await supabase
				.from('participants')
				.insert({
					session_id: sessionIdInt,
					bib_number: bibNumber,
					athlete_name: `選手${bibNumber}`
				})
				.select()
				.single();

			if (createError) {
				console.error('[submitBib] Error creating participant:', createError);
				console.error('[submitBib] Error details:', {
					code: createError.code,
					message: createError.message,
					details: createError.details,
					hint: createError.hint
				});
				return fail(500, { error: `参加者レコードの作成に失敗しました。${createError.message || ''}` });
			}

			if (!newParticipant) {
				return fail(500, { error: '参加者レコードの作成に失敗しました。' });
			}

			participantId = newParticipant.id;
		}

		// 大会モードまたは研修モードで採点指示を作成
		if (modeType === 'tournament' || modeType === 'training') {
			let discipline = '';
			let level = '';
			let event_name = '';

			if (modeType === 'tournament') {
				const { data: customEvent } = await supabase
					.from('custom_events')
					.select('*')
					.eq('id', eventId)
					.single();

				if (customEvent) {
					discipline = customEvent.discipline || '';
					level = customEvent.level || '';
					event_name = customEvent.event_name;
				}
			} else if (modeType === 'training') {
				const { data: trainingEvent } = await supabase
					.from('training_events')
					.select('*')
					.eq('id', eventId)
					.single();

				if (trainingEvent) {
					discipline = '';
					level = '';
					event_name = trainingEvent.name;
				}
			}

			if (event_name) {
				// scoring_prompts に採点指示を作成
				// event_id と mode を保存するために、discipline または level カラムを活用
				// discipline に mode (tournament/training) を、level に eventId を文字列として保存
				console.log('[submitBib] Creating scoring prompt:', {
					session_id: sessionIdInt,
					discipline: modeType,
					level: eventId.toString(),
					event_name,
					bib_number: bibNumber
				});

				const { data: prompt, error: promptError } = await supabase
					.from('scoring_prompts')
					.insert({
						session_id: sessionIdInt,
						discipline: modeType, // 'tournament' または 'training'
						level: eventId.toString(), // event_id を文字列として保存
						event_name: event_name,
						bib_number: bibNumber
					})
					.select()
					.single();

				if (promptError) {
					console.error('[submitBib] Error creating scoring prompt:', promptError);
					console.error('[submitBib] Prompt error details:', {
						code: promptError.code,
						message: promptError.message,
						details: promptError.details
					});
				}

				if (!promptError && prompt) {
					console.log('[submitBib] Scoring prompt created:', prompt.id);
					// セッションをアクティブにし、active_prompt_idを設定
					// status を 'active' に戻すことで、ended 状態から再開可能
					const { error: updateError } = await supabase
						.from('sessions')
						.update({
							active_prompt_id: prompt.id,
							is_active: true,
							status: 'active'  // セッションを再開（ended → active）
						})
						.eq('id', sessionIdInt);

					if (updateError) {
						console.error('[submitBib] Error updating session:', updateError);
					} else {
						console.log('[submitBib] Session updated with active_prompt_id:', prompt.id);
					}
				}
			}
		}

		return {
			success: true,
			bibNumber,
			participantId
		};
	}
};
