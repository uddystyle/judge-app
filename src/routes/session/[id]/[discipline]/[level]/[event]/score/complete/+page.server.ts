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

		// セッションの主任検定員かどうか確認
		const { data: session, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id, is_tournament_mode')
			.eq('id', id)
			.single();

		if (sessionError) {
			return fail(404, { error: '検定が見つかりません。' });
		}

		if (session.chief_judge_id !== user.id) {
			return fail(403, { error: '主任検定員のみが種目を変更できます。' });
		}

		// active_prompt_idをクリア（一般検定員を待機画面に戻す）
		const { error: updateError } = await supabase
			.from('sessions')
			.update({ active_prompt_id: null })
			.eq('id', id);

		if (updateError) {
			return fail(500, { error: 'セッションの更新に失敗しました。' });
		}

		// 大会モードの場合は種目選択画面へ、検定モードは種別選択画面へ
		if (session.is_tournament_mode) {
			throw redirect(303, `/session/${id}/tournament-events`);
		} else {
			throw redirect(303, `/session/${id}`);
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

		// 一般検定員への終了通知を挿入
		console.log('[主任検定員] 終了通知を挿入中...', { session_id: id });
		const { data: notificationData, error: notificationError } = await supabase
			.from('session_notifications')
			.insert({
				session_id: id,
				notification_type: 'session_ended'
			})
			.select();

		if (notificationError) {
			console.error('[主任検定員] ❌ 終了通知の挿入に失敗:', notificationError);
			// 通知の失敗はエラーにしない（セッションは終了済み）
		} else {
			console.log('[主任検定員] ✅ 終了通知を挿入しました:', notificationData);
		}

		// 成功したら待機画面（終了画面）にリダイレクト
		throw redirect(303, `/session/${id}?ended=true`);
	}
};
