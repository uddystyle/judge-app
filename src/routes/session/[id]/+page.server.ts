import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const sessionId = params.id;
	const guestIdentifier = url.searchParams.get('guest');

	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	// ゲストユーザーの情報を保持
	let guestParticipant = null;

	// ゲストユーザーの場合
	if (!user && guestIdentifier) {
		console.log('[Session Page] Guest identifier:', guestIdentifier);
		console.log('[Session Page] Session ID:', sessionId);

		// ゲスト参加者情報を取得
		const { data: guestData, error: guestError } = await supabase
			.from('session_participants')
			.select('*')
			.eq('session_id', sessionId)
			.eq('guest_identifier', guestIdentifier)
			.eq('is_guest', true)
			.single();

		console.log('[Session Page] Guest data:', guestData);
		console.log('[Session Page] Guest error:', guestError);

		if (guestError || !guestData) {
			// ゲスト情報が見つからない場合は招待ページへリダイレクト
			console.error('[Session Page] Guest not found, redirecting to join page');
			throw redirect(303, '/session/join');
		}

		guestParticipant = guestData;
		console.log('[Session Page] Guest authenticated successfully');
	}

	// 通常ユーザーでログインしていない場合はログインページへ
	if (!user && !guestIdentifier) {
		throw redirect(303, '/login');
	}

	// ユーザーのプロフィール情報を取得（ゲストの場合はスキップ）
	let profile = null;
	let organizations: any[] = [];

	if (user) {
		const { data: profileData } = await supabase
			.from('profiles')
			.select('full_name')
			.eq('id', user.id)
			.single();
		profile = profileData;

		// ユーザーが所属する組織を取得
		const { data: memberships } = await supabase
			.from('organization_members')
			.select('organization_id')
			.eq('user_id', user.id);
		organizations = memberships || [];
	}

	// セッションの詳細情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	// 組織セッションの場合、組織メンバーを自動的に参加者として追加（通常ユーザーのみ）
	if (sessionDetails.organization_id && user) {
		// ユーザーが組織メンバーかチェック
		const { data: membership } = await supabase
			.from('organization_members')
			.select('id')
			.eq('organization_id', sessionDetails.organization_id)
			.eq('user_id', user.id)
			.maybeSingle();

		if (membership) {
			// すでに参加者として登録されているかチェック
			const { data: existingParticipant } = await supabase
				.from('session_participants')
				.select('id')
				.eq('session_id', sessionId)
				.eq('user_id', user.id)
				.maybeSingle();

			// 未登録の場合のみ追加
			if (!existingParticipant) {
				await supabase.from('session_participants').insert({
					session_id: sessionId,
					user_id: user.id,
					is_guest: false
				});
			}
		}
	}

	// ログイン中のユーザーが主任検定員かどうかを判定
	const isChief = user ? user.id === sessionDetails.chief_judge_id : false;

	// 主任検定員が終了したセッションを選択した場合、自動的に再開
	// ただし、ended=trueパラメータがある場合（終了画面表示中）は再開しない
	const isEndedPage = url.searchParams.get('ended') === 'true';
	if (isChief && sessionDetails.status === 'ended' && !isEndedPage) {
		console.log('[Session Page] 主任検定員が終了したセッションを選択 - 自動的に再開します', { sessionId });
		await supabase
			.from('sessions')
			.update({
				status: 'active',
				is_active: true,
				active_prompt_id: null
			})
			.eq('id', sessionId);

		// セッション情報を更新
		sessionDetails.status = 'active';
		sessionDetails.is_active = true;
		sessionDetails.active_prompt_id = null;
		console.log('[Session Page] ✅ セッションを自動再開しました');
	}

	// 研修モードの場合
	if (sessionDetails.mode === 'training') {
		console.log('[Session Page Load] ========== 研修モード ==========');
		console.log('[Session Page Load] sessionId:', sessionId);
		console.log('[Session Page Load] user:', user?.id || 'guest');
		console.log('[Session Page Load] guestIdentifier:', guestIdentifier);

		// 研修セッション情報を取得
		const { data: trainingSession, error: trainingError } = await supabase
			.from('training_sessions')
			.select('*')
			.eq('session_id', sessionId)
			.maybeSingle();

		console.log('[Session Page Load] training_sessions取得結果:', { trainingSession, trainingError });
		console.log('[Session Page Load] is_multi_judge:', trainingSession?.is_multi_judge);

		if (trainingError) {
			throw error(500, '研修セッション情報の取得に失敗しました。');
		}

		// 研修種目の数を取得
		const { count: eventsCount } = await supabase
			.from('training_events')
			.select('*', { count: 'exact', head: true })
			.eq('session_id', sessionId);

		// 参加者一覧を取得（session_participantsとprofilesを結合）
		const { data: participants, error: participantsError } = await supabase
			.from('session_participants')
			.select(`
				user_id,
				profiles:user_id (
					full_name
				)
			`)
			.eq('session_id', sessionId);

		if (participantsError) {
			console.error('Error fetching participants:', participantsError);
			throw error(500, '参加者情報の取得に失敗しました。');
		}

		// 主任検定員のuser_idを取得（chief_judge_idがparticipants.idの場合）
		let chiefJudgeUserId = null;
		if (trainingSession?.chief_judge_id) {
			const { data: chiefParticipant } = await supabase
				.from('participants')
				.select('user_id')
				.eq('id', trainingSession.chief_judge_id)
				.maybeSingle();

			if (chiefParticipant) {
				chiefJudgeUserId = chiefParticipant.user_id;
			}
		}

		const returnData = {
			user,
			profile,
			organizations,
			isChief,
			sessionDetails,
			isTrainingMode: true,
			trainingSession,
			participants: participants || [],
			chiefJudgeUserId,
			hasEvents: (eventsCount || 0) > 0,
			isSessionActive: sessionDetails.is_active,
			isMultiJudge: trainingSession?.is_multi_judge || false,
			guestParticipant,
			guestIdentifier
		};

		console.log('[Session Page Load] ========== 返却データ ==========');
		console.log('[Session Page Load] isMultiJudge:', returnData.isMultiJudge);
		console.log('[Session Page Load] isChief:', returnData.isChief);
		console.log('[Session Page Load] guestIdentifier:', returnData.guestIdentifier);

		return returnData;
	}

	// 大会モードの場合
	if (sessionDetails.is_tournament_mode && isChief) {
		// カスタム種目の数を取得
		const { count: eventsCount } = await supabase
			.from('custom_events')
			.select('*', { count: 'exact', head: true })
			.eq('session_id', sessionId);

		return {
			user,
			profile,
			organizations,
			isChief,
			sessionDetails,
			isTournamentMode: true,
			isTrainingMode: false,
			hasEvents: (eventsCount || 0) > 0,
			isSessionActive: sessionDetails.is_active,
			isMultiJudge: true,
			guestParticipant,
			guestIdentifier
		};
	}

	// もし主任検定員なら、種別選択に必要なデータを取得
	if (isChief) {
		const { data: events, error: eventsError } = await supabase.from('events').select('discipline');

		if (eventsError) {
			throw error(500, '種別情報の取得に失敗しました。');
		}

		const disciplines = [...new Set(events.map((e) => e.discipline))];

		return {
			user,
			profile,
			organizations,
			isChief,
			sessionDetails,
			disciplines,
			isTournamentMode: false,
			isTrainingMode: false,
			isSessionActive: sessionDetails.is_active,
			isMultiJudge: sessionDetails.is_multi_judge || false,
			guestParticipant,
			guestIdentifier
		};
	}

	// 一般の検定員の場合
	// 検定モードで複数検定員OFFの場合は、種別選択ができるようにdisciplinesを渡す
	if (!sessionDetails.is_tournament_mode && !sessionDetails.is_multi_judge) {
		const { data: events, error: eventsError } = await supabase.from('events').select('discipline');

		if (eventsError) {
			throw error(500, '種別情報の取得に失敗しました。');
		}

		const disciplines = [...new Set(events.map((e) => e.discipline))];

		return {
			user,
			profile,
			organizations,
			isChief,
			sessionDetails,
			disciplines,
			isTournamentMode: false,
			isTrainingMode: false,
			isSessionActive: sessionDetails.is_active,
			isMultiJudge: sessionDetails.is_multi_judge || false,
			guestParticipant,
			guestIdentifier
		};
	}

	// その他の一般検定員とゲストユーザーの場合
	// ゲストユーザーでも種別選択が必要な場合があるため、disciplinesを取得
	let disciplines: string[] | undefined = undefined;

	// 大会モードは常に複数検定員モードON、それ以外はsessionDetailsの値を使用
	const isTournamentMode = sessionDetails.is_tournament_mode || sessionDetails.mode === 'tournament';
	const isMultiJudge = isTournamentMode ? true : (sessionDetails.is_multi_judge ?? false);

	if (!sessionDetails.is_tournament_mode && !isMultiJudge && sessionDetails.mode !== 'training') {
		const { data: events, error: eventsError } = await supabase.from('events').select('discipline');
		if (!eventsError && events) {
			disciplines = [...new Set(events.map((e) => e.discipline))];
		}
	}
	return {
		user,
		profile,
		organizations,
		isChief,
		sessionDetails,
		isTournamentMode,
		isTrainingMode: sessionDetails.mode === 'training',
		isSessionActive: sessionDetails.is_active,
		guestParticipant,
		guestIdentifier,
		disciplines,
		isMultiJudge
	};
};

export const actions: Actions = {
	// 主任検定員を設定
	setChiefJudge: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const sessionId = params.id;
		const formData = await request.formData();
		const selectedUserId = formData.get('userId') as string;

		if (!selectedUserId) {
			return fail(400, { error: '検定員を選択してください。' });
		}

		// セッションの作成者かどうかチェック
		const { data: session, error: sessionError } = await supabase
			.from('sessions')
			.select('created_by, mode')
			.eq('id', sessionId)
			.single();

		if (sessionError || !session) {
			return fail(404, { error: 'セッションが見つかりません。' });
		}

		if (session.created_by !== user.id) {
			return fail(403, { error: '主任検定員を設定する権限がありません。' });
		}

		if (session.mode !== 'training') {
			return fail(400, { error: '研修モードのセッションのみ主任検定員を設定できます。' });
		}

		// 選択されたユーザーのparticipants.idを取得
		// 研修モードでは、participantsテーブルにレコードが存在しない可能性があるため、
		// まずsession_participantsで参加者かどうか確認し、必要ならparticipantsレコードを作成
		const { data: sessionParticipant } = await supabase
			.from('session_participants')
			.select('user_id, is_guest')
			.eq('session_id', sessionId)
			.eq('user_id', selectedUserId)
			.maybeSingle();

		if (!sessionParticipant) {
			return fail(400, { error: '選択されたユーザーはこのセッションの参加者ではありません。' });
		}

		// ゲストユーザーは主任検定員に任命できない
		if (sessionParticipant.is_guest) {
			return fail(400, { error: 'ゲストユーザーは主任検定員に任命できません。' });
		}

		// participantsテーブルにレコードを作成（存在しない場合）
		// 注: 研修モードではparticipantsテーブルは使わないかもしれないが、
		// chief_judge_idがparticipants.idを参照するため、レコードを作成する必要がある
		const { data: participant, error: participantError } = await supabase
			.from('participants')
			.upsert(
				{
					session_id: sessionId,
					user_id: selectedUserId,
					bib_number: 0 // ダミーのゼッケン番号（研修モードでは使用しない）
				},
				{ onConflict: 'session_id,user_id' }
			)
			.select()
			.single();

		if (participantError || !participant) {
			return fail(500, { error: '参加者レコードの作成に失敗しました。' });
		}

		// training_sessionsテーブルを更新
		const { error: updateError } = await supabase
			.from('training_sessions')
			.update({ chief_judge_id: participant.id })
			.eq('session_id', sessionId);

		if (updateError) {
			return fail(500, { error: '主任検定員の設定に失敗しました。' });
		}

		return { success: true };
	},

	// ゲストユーザーの名前を更新
	updateGuestName: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const guestIdentifier = formData.get('guestIdentifier') as string;
		const newGuestName = formData.get('guestName') as string;

		if (!guestIdentifier || !newGuestName || newGuestName.trim().length === 0) {
			return fail(400, { guestNameError: '名前を入力してください。' });
		}

		if (newGuestName.trim().length > 50) {
			return fail(400, { guestNameError: '名前は50文字以内で入力してください。' });
		}

		const sessionId = params.id;

		// ゲスト参加者の名前を更新
		const { error: updateError } = await supabase
			.from('session_participants')
			.update({ guest_name: newGuestName.trim() })
			.eq('session_id', sessionId)
			.eq('guest_identifier', guestIdentifier)
			.eq('is_guest', true);

		if (updateError) {
			return fail(500, { guestNameError: '名前の更新に失敗しました。' });
		}

		return { guestNameSuccess: '名前を更新しました。' };
	},

	// セッションを再開
	restartSession: async ({ params, locals: { supabase }, url }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		const { id } = params;
		const guestIdentifier = url.searchParams.get('guest');

		// ゲストユーザーの場合
		if (!user && guestIdentifier) {
			const { data: guestData, error: guestError } = await supabase
				.from('session_participants')
				.select('*')
				.eq('session_id', id)
				.eq('guest_identifier', guestIdentifier)
				.eq('is_guest', true)
				.single();

			if (guestError || !guestData) {
				return fail(401, { error: 'ゲスト認証が必要です。' });
			}
		} else if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		// セッション情報を取得して権限確認
		const { data: session, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id, is_multi_judge, status')
			.eq('id', id)
			.single();

		if (sessionError) {
			return fail(404, { error: '検定が見つかりません。' });
		}

		const isChief = user ? session.chief_judge_id === user.id : false;

		// 主任検定員、複数検定員モードOFF、またはゲストユーザーの場合のみ実行可能
		// 通常の一般検定員は複数検定員モードONの場合は再開不可
		if (!isChief && session.is_multi_judge && !guestIdentifier) {
			return fail(403, { error: 'セッションを再開する権限がありません。' });
		}

		// セッションが終了状態でない場合はエラー
		if (session.status !== 'ended') {
			return fail(400, { error: 'このセッションは終了していません。' });
		}

		// セッションを再開状態に更新
		// status を 'active' に設定し、is_active を true にし、active_prompt_id をクリア
		const { error: updateError } = await supabase
			.from('sessions')
			.update({
				status: 'active',
				is_active: true,
				active_prompt_id: null
			})
			.eq('id', id);

		if (updateError) {
			console.error('Error restarting session:', updateError);
			return fail(500, { error: 'セッションの再開に失敗しました。' });
		}

		console.log('[セッション再開] ✅ セッションを再開しました', { sessionId: id });

		// 同じページにリダイレクト（終了フラグを削除）
		// restart=true パラメータを付けて、誤った終了検知を防ぐ
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}&join=true` : '?restart=true';
		throw redirect(303, `/session/${id}${guestParam}`);
	}
};
