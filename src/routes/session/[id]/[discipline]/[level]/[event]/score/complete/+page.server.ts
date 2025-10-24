import { error, redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const { id, discipline, level, event } = params;
	const bib = url.searchParams.get('bib');
	const averageScore = url.searchParams.get('score');

	if (!bib) {
		throw error(400, 'ゼッケン番号が指定されていません。');
	}

	// セッション情報を取得（複数検定員モードか確認）
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('is_multi_judge, required_judges, chief_judge_id')
		.eq('id', id)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	const isChief = sessionDetails.chief_judge_id === user.id;

	// 全検定員の得点を取得
	const { data: scores, error: scoresError } = await supabase
		.from('results')
		.select('judge_name, score')
		.eq('session_id', id)
		.eq('bib', bib)
		.eq('discipline', discipline)
		.eq('level', level)
		.eq('event_name', event);

	if (scoresError) {
		console.error('Failed to fetch scores:', scoresError);
		throw error(500, '得点の取得に失敗しました。');
	}

	return {
		bib,
		averageScore,
		isMultiJudge: sessionDetails.is_multi_judge,
		scores: scores || [],
		isChief
	};
};

export const actions: Actions = {
	endSession: async ({ params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		const { id } = params;

		// セッションの主任検定員かどうか確認
		const { data: session, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id')
			.eq('id', id)
			.single();

		if (sessionError) {
			return fail(404, { error: '検定が見つかりません。' });
		}

		if (session.chief_judge_id !== user.id) {
			return fail(403, { error: '主任検定員のみが検定を終了できます。' });
		}

		// セッションを非アクティブにし、active_prompt_idをクリア
		const { error: updateError } = await supabase
			.from('sessions')
			.update({ is_active: false, active_prompt_id: null })
			.eq('id', id);

		if (updateError) {
			return fail(500, { error: '検定の終了に失敗しました。' });
		}

		// 成功したらダッシュボードにリダイレクト
		throw redirect(303, '/dashboard');
	}
};
