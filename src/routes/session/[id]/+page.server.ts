import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const sessionId = params.id;

	// セッションの詳細情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	// ログイン中のユーザーが主任検定員かどうかを判定
	const isChief = user.id === sessionDetails.chief_judge_id;

	// 研修モードの場合
	if (sessionDetails.mode === 'training') {
		// 研修セッション情報を取得
		const { data: trainingSession, error: trainingError } = await supabase
			.from('training_sessions')
			.select('*')
			.eq('session_id', sessionId)
			.maybeSingle();

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

		return {
			isChief,
			sessionDetails,
			isTrainingMode: true,
			trainingSession,
			participants: participants || [],
			chiefJudgeUserId,
			hasEvents: (eventsCount || 0) > 0,
			isSessionActive: sessionDetails.is_active
		};
	}

	// 大会モードの場合
	if (sessionDetails.is_tournament_mode && isChief) {
		// カスタム種目の数を取得
		const { count: eventsCount } = await supabase
			.from('custom_events')
			.select('*', { count: 'exact', head: true })
			.eq('session_id', sessionId);

		return {
			isChief,
			sessionDetails,
			isTournamentMode: true,
			hasEvents: (eventsCount || 0) > 0,
			isSessionActive: sessionDetails.is_active
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
			isChief,
			sessionDetails,
			disciplines,
			isTournamentMode: false,
			isSessionActive: sessionDetails.is_active
		};
	}

	// 一般の検定員の場合は、待機画面を表示するための情報だけを渡す
	return {
		isChief,
		sessionDetails,
		isTournamentMode: sessionDetails.is_tournament_mode,
		isSessionActive: sessionDetails.is_active
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
			.select('user_id')
			.eq('session_id', sessionId)
			.eq('user_id', selectedUserId)
			.maybeSingle();

		if (!sessionParticipant) {
			return fail(400, { error: '選択されたユーザーはこのセッションの参加者ではありません。' });
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
	}
};
