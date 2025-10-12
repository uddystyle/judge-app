import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, getSession } }) => {
	const session = await getSession();
	if (!session) {
		throw redirect(303, '/login');
	}

	const sessionId = params.id;

	// --- セッションの詳細情報を取得 ---
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	// データベースからの取得に失敗した場合のデバッグログを追加
	if (sessionError) {
		// RLSが原因でデータが見つからない場合、Supabaseは404エラーではなく、エラーオブジェクトを返すため、ここで404を投げる
		throw error(404, {
			message: '検定が見つかりません。データベースのアクセス権限を確認してください。'
		});
	}

	// --- 参加者の一覧をプロフィール情報と共に取得 ---
	const { data: participants, error: participantsError } = await supabase
		.from('session_participants')
		.select('user_id, profile:profiles(full_name)')
		.eq('session_id', sessionId);

	if (participantsError) {
		throw error(500, '参加者情報の取得に失敗しました。');
	}

	return {
		currentUserId: session.user.id,
		sessionDetails,
		participants
	};
};

// --- フォームアクション（名前の更新など） ---
export const actions: Actions = {
	updateName: async ({ request, params, locals: { supabase, getSession } }) => {
		const session = await getSession();
		if (!session) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const newName = formData.get('sessionName') as string;

		if (!newName || newName.trim().length === 0) {
			return fail(400, { error: '検定名は必須です。' });
		}

		// sessionsテーブルの名前を更新
		const { error: updateError } = await supabase
			.from('sessions')
			.update({ name: newName })
			.eq('id', params.id);

		if (updateError) {
			return fail(500, { error: '更新に失敗しました: ' + updateError.message });
		}

		return { success: true, message: '検定名を更新しました。' };
	},

	appointChief: async ({ request, params, locals: { supabase, getSession } }) => {
		const session = await getSession();
		if (!session) {
			throw redirect(303, '/login');
		}

		// フォームから任命するユーザーのIDを取得
		const formData = await request.formData();
		const userIdToAppoint = formData.get('userId') as string;

		// データベースを更新
		const { data: currentSession, error: fetchError } = await supabase
			.from('sessions')
			.select('chief_judge_id')
			.eq('id', params.id)
			.single();

		if (fetchError) {
			return fail(500, { error: '現在のセッション情報の取得に失敗しました。' });
		}

		const newChiefId = currentSession?.chief_judge_id === userIdToAppoint ? null : userIdToAppoint;

		const { error: appointError } = await supabase
			.from('sessions')
			.update({ chief_judge_id: newChiefId })
			.eq('id', params.id);

		if (appointError) {
			return fail(500, { error: '主任の任命/解除に失敗しました。' });
		}

		return { success: true };
	},

	updateSettings: async ({ request, params, locals: { supabase, getSession } }) => {
		const session = await getSession();
		if (!session) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const isMultiJudge = formData.get('isMultiJudge') === 'true';
		const requiredJudges = Number(formData.get('requiredJudges'));

		// Validate requiredJudges
		if (isMultiJudge && (!requiredJudges || requiredJudges < 1)) {
			return fail(400, { settingsError: '必須審判員数を正しく入力してください。' });
		}

		// Check participant count if multi-judge mode is enabled
		if (isMultiJudge) {
			const { count, error: countError } = await supabase
				.from('session_participants')
				.select('*', { count: 'exact', head: true })
				.eq('session_id', params.id);

			if (countError) {
				return fail(500, { settingsError: '参加者数の確認に失敗しました。' });
			}

			if (requiredJudges > (count || 0)) {
				return fail(400, {
					settingsError: `必須審判員数は参加者数（${count}人）以下にしてください。`
				});
			}
		}

		const { error: updateError } = await supabase
			.from('sessions')
			.update({
				is_multi_judge: isMultiJudge,
				required_judges: isMultiJudge ? requiredJudges : null
			})
			.eq('id', params.id);

		if (updateError) {
			return fail(500, { settingsError: '設定の更新に失敗しました。' });
		}

		return { settingsSuccess: '設定を更新しました。' };
	}
};
