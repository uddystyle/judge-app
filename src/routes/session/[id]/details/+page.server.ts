import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
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
	// まず参加者のuser_idを取得
	const { data: participantIds, error: participantsError } = await supabase
		.from('session_participants')
		.select('user_id')
		.eq('session_id', sessionId);

	if (participantsError) {
		throw error(500, '参加者情報の取得に失敗しました。');
	}

	// 各参加者のプロフィール情報を個別に取得してマージ
	const participants = await Promise.all(
		(participantIds || []).map(async (p) => {
			const { data: profile } = await supabase
				.from('profiles')
				.select('full_name')
				.eq('id', p.user_id)
				.single();

			return {
				user_id: p.user_id,
				profiles: profile
			};
		})
	);

	return {
		currentUserId: user.id,
		sessionDetails,
		participants
	};
};

// --- フォームアクション（名前の更新など） ---
export const actions: Actions = {
	updateName: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
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

	appointChief: async ({ request, params, locals: { supabase } }) => {
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

	updateSettings: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
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
	},

	deleteSession: async ({ params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const sessionId = params.id;

		// First, verify that the current user is the creator of the session
		const { data: sessionData } = await supabase
			.from('sessions')
			.select('created_by')
			.eq('id', sessionId)
			.single();

		if (sessionData?.created_by !== user.id) {
			return fail(403, { error: 'この検定を削除する権限がありません。' });
		}

		// Delete related data in the correct order to respect database constraints
		await supabase.from('results').delete().eq('session_id', sessionId);
		await supabase.from('session_participants').delete().eq('session_id', sessionId);
		await supabase.from('scoring_prompts').delete().eq('session_id', sessionId);

		// Finally, delete the session itself
		const { error: deleteError } = await supabase.from('sessions').delete().eq('id', sessionId);

		if (deleteError) {
			return fail(500, { error: '検定の削除に失敗しました。' });
		}

		// If successful, redirect to the dashboard
		throw redirect(303, '/dashboard');
	}
};
