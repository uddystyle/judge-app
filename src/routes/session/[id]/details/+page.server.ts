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
	}
};
