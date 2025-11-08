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
		.select('is_multi_judge, required_judges, chief_judge_id, is_tournament_mode')
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
		isChief,
		isTournamentMode: sessionDetails.is_tournament_mode
	};
};

export const actions: Actions = {
	changeEvent: async ({ params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		const { id } = params;

		// セッション情報を取得して権限確認
		const { data: session, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id, is_tournament_mode, is_multi_judge')
			.eq('id', id)
			.single();

		if (sessionError) {
			return fail(404, { error: '検定が見つかりません。' });
		}

		const isChief = session.chief_judge_id === user.id;

		// 主任検定員または複数検定員モードOFFの場合のみ実行可能
		if (!isChief && session.is_multi_judge) {
			return fail(403, { error: '種目を変更する権限がありません。' });
		}

		// active_prompt_idをクリア（一般検定員を待機画面に戻す）
		const { error: updateError } = await supabase
			.from('sessions')
			.update({ active_prompt_id: null })
			.eq('id', id);

		if (updateError) {
			return fail(500, { error: 'セッションの更新に失敗しました。' });
		}

		// 大会モードの場合は種目選択画面へ、検定モードも種目選択画面へ
		if (session.is_tournament_mode) {
			throw redirect(303, `/session/${id}/tournament-events`);
		} else {
			// 検定モード: 種目選択画面にリダイレクト
			const { discipline, level } = params;
			throw redirect(303, `/session/${id}/${discipline}/${level}`);
		}
	},

	endSession: async ({ params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: '認証が必要です。' });
		}

		const { id } = params;

		// セッション情報を取得して権限確認
		const { data: session, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id, is_multi_judge')
			.eq('id', id)
			.single();

		if (sessionError) {
			return fail(404, { error: '検定が見つかりません。' });
		}

		const isChief = session.chief_judge_id === user.id;

		// 主任検定員または複数検定員モードOFFの場合のみ実行可能
		if (!isChief && session.is_multi_judge) {
			return fail(403, { error: 'セッションを終了する権限がありません。' });
		}

		// セッションを終了状態に更新
		// status を 'ended' に設定し、is_active と active_prompt_id をクリア
		const { error: updateError } = await supabase
			.from('sessions')
			.update({
				status: 'ended',
				is_active: false,
				active_prompt_id: null
			})
			.eq('id', id);

		if (updateError) {
			console.error('Error ending session:', updateError);
			return fail(500, { error: '検定の終了に失敗しました。' });
		}

		console.log('[主任検定員] ✅ セッションを終了しました', { sessionId: id });

		// セッション詳細画面（終了画面）にリダイレクト
		throw redirect(303, `/session/${id}?ended=true`);
	}
};
