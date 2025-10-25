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

	const { id: sessionId } = params;

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

	return {
		sessionDetails
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
