import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	// 'join'アクションは、フォームが送信されたときに呼び出される
	join: async ({ request, locals: { supabase, getSession } }) => {
		const session = await getSession();
		if (!session) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const joinCode = formData.get('joinCode') as string;

		// 簡単なバリデーション
		if (!joinCode || joinCode.trim().length !== 6) {
			return fail(400, { joinCode, error: '6桁の参加コードを入力してください。' });
		}

		// 参加コードに一致するセッションをデータベースから検索
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.select('id')
			.eq('join_code', joinCode.toUpperCase()) // 大文字に統一して検索
			.single();

		if (sessionError || !sessionData) {
			return fail(404, { joinCode, error: '無効な参加コードです。' });
		}

		const { error: joinError } = await supabase.from('session_participants').insert({
			session_id: sessionData.id,
			user_id: session.user.id
		});

		// 23505はunique_violationエラー（既にメンバーである場合）。
		// このエラーは無視して成功とみなす。それ以外のエラーは失敗として処理。
		if (joinError && joinError.code !== '23505') {
			console.error('Failed to join session:', joinError);
			return fail(500, {
				joinCode,
				error: `サーバーエラー: 検定への参加に失敗しました。 (${joinError.message || joinError.code})`
			});
		}

		// 成功したら、ダッシュボードへリダイレクト
		throw redirect(303, '/dashboard');
	}
};
