import { fail, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';

// 参加者管理アクション（details ページ）。挙動は page.server.actions.test.ts で固定。

export const appointChief = async ({ request, params, locals: { supabase } }: RequestEvent) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// フォームから任命するユーザーのIDを取得
	const formData = await request.formData();
	const userIdToAppoint = formData.get('userId') as string;

	// 任命しようとしているユーザーがゲストでないか確認
	const { data: participantData } = await supabase
		.from('session_participants')
		.select('is_guest')
		.eq('session_id', params.id)
		.eq('user_id', userIdToAppoint)
		.single();

	if (participantData?.is_guest) {
		return fail(400, { error: m.action_guestCannotBeChief() });
	}

	// データベースを更新
	const { data: currentSession, error: fetchError } = await supabase
		.from('sessions')
		.select('chief_judge_id')
		.eq('id', params.id)
		.single();

	if (fetchError) {
		return fail(500, { error: m.action_fetchSessionFailed() });
	}

	const newChiefId = currentSession?.chief_judge_id === userIdToAppoint ? null : userIdToAppoint;

	const { error: appointError } = await supabase
		.from('sessions')
		.update({ chief_judge_id: newChiefId })
		.eq('id', params.id);

	if (appointError) {
		return fail(500, { error: m.action_appointFailed() });
	}

	return { success: true };
};

export const removeGuest = async ({ request, params, locals: { supabase } }: RequestEvent) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const formData = await request.formData();
	const guestIdentifier = formData.get('guestIdentifier') as string;

	if (!guestIdentifier) {
		return fail(400, { error: m.action_guestIdMissing() });
	}

	// セッションの作成者であることを確認
	const { data: session, error: sessionError } = await supabase
		.from('sessions')
		.select('created_by')
		.eq('id', params.id)
		.single();

	if (sessionError || !session) {
		return fail(404, { error: m.action_sessionNotFound() });
	}

	if (session.created_by !== user.id) {
		return fail(403, { error: m.action_noPermissionRemoveGuest() });
	}

	// ゲストユーザーをsession_participantsから削除
	const { error: deleteError } = await supabase
		.from('session_participants')
		.delete()
		.eq('session_id', params.id)
		.eq('guest_identifier', guestIdentifier)
		.eq('is_guest', true);

	if (deleteError) {
		return fail(500, { error: m.action_removeGuestFailed() });
	}

	return { success: true, message: m.action_guestRemoved() };
};

export const removeParticipant = async ({
	request,
	params,
	locals: { supabase }
}: RequestEvent) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const formData = await request.formData();
	const participantUserId = formData.get('userId') as string;

	if (!participantUserId) {
		return fail(400, { error: m.action_userIdMissing() });
	}

	// セッションの詳細を取得（作成者と主任検定員を確認）
	const { data: session, error: sessionError } = await supabase
		.from('sessions')
		.select('created_by, chief_judge_id')
		.eq('id', params.id)
		.single();

	if (sessionError || !session) {
		return fail(404, { error: m.action_sessionNotFound() });
	}

	// 作成者のみが検定員を削除できる
	if (session.created_by !== user.id) {
		return fail(403, { error: m.action_noPermissionRemoveJudge() });
	}

	// 自分自身を削除しようとしている場合はエラー
	if (participantUserId === user.id) {
		return fail(400, { error: m.action_cannotRemoveSelf() });
	}

	// 主任検定員を削除しようとしている場合はエラー
	if (participantUserId === session.chief_judge_id) {
		return fail(400, { error: m.action_cannotRemoveChief() });
	}

	// 検定員をsession_participantsから削除
	const { error: deleteError } = await supabase
		.from('session_participants')
		.delete()
		.eq('session_id', params.id)
		.eq('user_id', participantUserId)
		.eq('is_guest', false);

	if (deleteError) {
		return fail(500, { error: m.action_removeJudgeFailed() });
	}

	return { success: true, message: m.action_judgeRemoved() };
};
