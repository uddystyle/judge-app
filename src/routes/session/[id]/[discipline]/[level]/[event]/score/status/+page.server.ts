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

	// セッションの詳細情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	return {
		user,
		sessionDetails
	};
};

export const actions: Actions = {
	finalizeScore: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const { id, discipline, level, event } = params;
		const formData = await request.formData();
		const bib = formData.get('bib') as string;

		if (!bib) {
			return fail(400, { error: 'ゼッケン番号が指定されていません。' });
		}

		// セッション情報を取得して主任検定員かチェック
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id')
			.eq('id', id)
			.single();

		if (sessionError || sessionData.chief_judge_id !== user.id) {
			return fail(403, { error: '主任検定員のみが確定できます。' });
		}

		// 全ての得点を取得
		const { data: scores, error: scoresError } = await supabase
			.from('results')
			.select('score')
			.eq('session_id', id)
			.eq('bib', bib)
			.eq('discipline', discipline)
			.eq('level', level)
			.eq('event_name', event);

		if (scoresError) {
			return fail(500, { error: '得点の取得に失敗しました。' });
		}

		if (!scores || scores.length === 0) {
			return fail(400, { error: '採点結果がありません。' });
		}

		// 平均点を計算
		const total = scores.reduce((sum, s) => sum + s.score, 0);
		const average = Math.round(total / scores.length);

		// active_prompt_idをクリアして次の採点を受け付けられるようにする
		await supabase.from('sessions').update({ active_prompt_id: null }).eq('id', id);

		// 完了画面へリダイレクト
		throw redirect(
			303,
			`/session/${id}/${discipline}/${level}/${event}/score/complete?bib=${bib}&score=${average}`
		);
	}
};
