import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { authenticateSession } from '$lib/server/sessionAuth';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { id: sessionId } = params;

	// セッション認証（ログインユーザー専用）
	const { user } = await authenticateSession(supabase, sessionId, null);

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	// 大会モードでない場合はダッシュボードにリダイレクト
	if (!sessionDetails.is_tournament_mode) {
		throw redirect(303, '/dashboard');
	}

	// 作成者または主任検定員のみアクセス可能
	const isAuthorized =
		sessionDetails.created_by === user.id ||
		sessionDetails.chief_judge_id === user.id;

	if (!isAuthorized) {
		throw redirect(303, `/session/${sessionId}`);
	}

	// セッション参加者数（検定員数）を取得
	const { data: participants, error: participantsError } = await supabase
		.from('session_participants')
		.select('id')
		.eq('session_id', sessionId);

	const judgeCount = participants?.length || 0;

	// プロフィール情報を取得
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
		user,
		profile,
		sessionDetails,
		judgeCount
	};
};

export const actions: Actions = {
	// 採点方式を更新
	updateScoringMethod: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		const formData = await request.formData();
		const scoringMethod = formData.get('scoringMethod') as string;

		// バリデーション
		if (!scoringMethod || (scoringMethod !== '3judges' && scoringMethod !== '5judges')) {
			return fail(400, { error: '採点方式を選択してください。' });
		}

		// セッション参加者数（検定員数）を取得
		const { data: participants } = await supabase
			.from('session_participants')
			.select('id')
			.eq('session_id', params.id);

		const judgeCount = participants?.length || 0;

		// 検定員数のバリデーション（厳密に一致する必要がある）
		if (scoringMethod === '3judges' && judgeCount !== 3) {
			return fail(400, { error: '3審3採を選択するには、検定員数がちょうど3人である必要があります。' });
		}

		if (scoringMethod === '5judges' && judgeCount !== 5) {
			return fail(400, { error: '5審3採を選択するには、検定員数がちょうど5人である必要があります。' });
		}

		const excludeExtremes = scoringMethod === '5judges';

		// 採点方式を更新
		const { error: updateError } = await supabase
			.from('sessions')
			.update({
				exclude_extremes: excludeExtremes
			})
			.eq('id', params.id);

		if (updateError) {
			console.error('Error updating scoring method:', updateError);
			return fail(500, { error: '採点方式の更新に失敗しました。' });
		}

		return { success: true, message: '採点方式を更新しました。' };
	}
};
