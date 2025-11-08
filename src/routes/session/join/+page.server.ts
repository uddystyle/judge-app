import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { checkCanAddJudgeToSession } from '$lib/server/organizationLimits';

export const actions: Actions = {
	// 'join'アクションは、フォームが送信されたときに呼び出される
	join: async ({ request, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const joinCode = (formData.get('joinCode') as string)?.trim().toUpperCase();

		// バリデーション
		if (!joinCode) {
			return fail(400, { joinCode: '', error: '参加コードを入力してください。' });
		}

		if (joinCode.length !== 6) {
			return fail(400, { joinCode, error: '参加コードは6桁です。' });
		}

		// 英数字のみ許可
		if (!/^[A-Z0-9]{6}$/.test(joinCode)) {
			return fail(400, { joinCode, error: '参加コードは英数字6桁で入力してください。' });
		}

		// 参加コードに一致するセッションをデータベースから検索
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.select('id, is_accepting_participants')
			.eq('join_code', joinCode)
			.single();

		if (sessionError || !sessionData) {
			return fail(404, { joinCode, error: '無効な参加コードです。' });
		}

		// セッションが参加受付中かチェック
		if (!sessionData.is_accepting_participants) {
			return fail(400, { joinCode, error: 'このセッションは参加受付を終了しています。' });
		}

		// 検定員数制限チェック
		const judgeCheck = await checkCanAddJudgeToSession(supabase, sessionData.id);
		if (!judgeCheck.allowed) {
			return fail(403, {
				joinCode,
				error: judgeCheck.reason || 'セッションの検定員数上限に達しています。',
				upgradeUrl: judgeCheck.upgradeUrl
			});
		}

		const { error: joinError } = await supabase.from('session_participants').insert({
			session_id: sessionData.id,
			user_id: user.id
		});

		// 23505はunique_violationエラー（既にメンバーである場合）。
		// このエラーは無視して成功とみなす。それ以外のエラーは失敗として処理。
		if (joinError && joinError.code !== '23505') {
			console.error('Failed to join session:', joinError);
			return fail(500, {
				joinCode,
				error: 'サーバーエラー: 検定への参加に失敗しました。'
			});
		}

		// 成功したら、ダッシュボードへリダイレクト
		throw redirect(303, '/dashboard');
	}
};
