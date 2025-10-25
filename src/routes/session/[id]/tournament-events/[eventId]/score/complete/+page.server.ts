import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const { id: sessionId, eventId } = params;
	const bib = url.searchParams.get('bib');
	const score = url.searchParams.get('score');

	if (!bib || !score) {
		throw error(400, 'ゼッケン番号または得点が指定されていません。');
	}

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '検定が見つかりません。');
	}

	// 大会モードでない場合はエラー
	if (!sessionDetails.is_tournament_mode) {
		throw redirect(303, `/session/${sessionId}`);
	}

	// カスタム種目の情報を取得
	const { data: customEvent, error: eventError } = await supabase
		.from('custom_events')
		.select('*')
		.eq('id', eventId)
		.eq('session_id', sessionId)
		.single();

	if (eventError) {
		console.error('Error fetching custom event:', eventError);
		throw error(404, '種目が見つかりません。');
	}

	// 各検定員の得点を取得
	const { data: scores, error: scoresError } = await supabase
		.from('results')
		.select('judge_name, score')
		.eq('session_id', sessionId)
		.eq('bib', bib)
		.eq('discipline', customEvent.discipline)
		.eq('level', customEvent.level)
		.eq('event_name', customEvent.event_name);

	if (scoresError) {
		console.error('Error fetching scores:', scoresError);
		throw error(500, '得点の取得に失敗しました。');
	}

	const isChief = user.id === sessionDetails.chief_judge_id;

	return {
		sessionDetails,
		customEvent,
		bib,
		totalScore: parseInt(score),
		scores: scores || [],
		isChief,
		excludeExtremes: sessionDetails.exclude_extremes
	};
};

export const actions: Actions = {
	endSession: async ({ params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const { id: sessionId } = params;

		// セッション情報を取得して主任検定員かチェック
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.select('chief_judge_id')
			.eq('id', sessionId)
			.single();

		if (sessionError || sessionData.chief_judge_id !== user.id) {
			return { success: false, error: '主任検定員のみが終了できます。' };
		}

		// セッションを終了
		const { error: updateError } = await supabase
			.from('sessions')
			.update({ is_active: false })
			.eq('id', sessionId);

		if (updateError) {
			console.error('Error ending session:', updateError);
			return { success: false, error: 'セッションの終了に失敗しました。' };
		}

		// ダッシュボードへリダイレクト
		throw redirect(303, '/dashboard');
	}
};
