import { json, redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	// Only logged-in users can export data
	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const { sessionId } = params;

	console.log('[Export API] セッションID:', sessionId);

	// セッションIDのバリデーション
	const sessionIdNum = parseInt(sessionId);
	if (isNaN(sessionIdNum)) {
		console.error('[Export API] 無効なセッションID');
		throw error(400, '無効なセッションIDです。');
	}

	console.log('[Export API] ユーザーID:', user.id, 'セッションID:', sessionIdNum);

	// ユーザーがこのセッションの参加者かどうかをチェック
	const { data: participant, error: participantError } = await supabase
		.from('session_participants')
		.select('session_id, user_id')
		.eq('session_id', sessionIdNum)
		.eq('user_id', user.id)
		.single();

	console.log('[Export API] 参加者チェック:', { participant, error: participantError });

	if (participantError || !participant) {
		console.error('[Export API] Unauthorized export attempt:', { userId: user.id, sessionId: sessionIdNum });
		throw error(403, 'このセッションにアクセスする権限がありません。');
	}

	// セッション情報を取得してモードを確認
	const { data: session, error: sessionError } = await supabase
		.from('sessions')
		.select('mode, is_tournament_mode')
		.eq('id', sessionIdNum)
		.single();

	console.log('[Export API] セッション情報:', { session, error: sessionError });

	if (sessionError) {
		console.error('[Export API] Failed to fetch session:', sessionError);
		return json({ error: 'セッション情報の取得に失敗しました。' }, { status: 500 });
	}

	let exportData: any[] = [];

	// モードに応じてデータを取得
	console.log('[Export API] セッションモード:', session.mode);

	if (session.mode === 'training') {
		// 研修モード: training_scoresから取得
		console.log('[Export API] 研修モードの結果を取得中...');
		const { data: trainingScores, error: scoresError } = await supabase
			.from('training_scores')
			.select(
				`
				created_at,
				score,
				judge_id,
				athlete:athlete_id(bib_number),
				training_events!inner(session_id, name)
			`
			)
			.eq('training_events.session_id', sessionIdNum)
			.order('created_at', { ascending: true });

		console.log('[Export API] 研修モード結果:', { count: trainingScores?.length, error: scoresError });

		if (scoresError) {
			console.error('[Export API] Failed to fetch training scores:', scoresError);
			return json({ error: '研修モードの結果取得に失敗しました。' }, { status: 500 });
		}

		// 検定員名を一括取得してマージ（N+1クエリを回避）
		if (trainingScores && trainingScores.length > 0) {
			// ユニークな検定員IDを抽出
			const judgeIds = [...new Set(trainingScores.map(score => score.judge_id))];

			// 検定員名を一括取得
			const { data: judgeProfiles } = await supabase
				.from('profiles')
				.select('id, full_name')
				.in('id', judgeIds);

			// 検定員IDから名前へのマップを作成
			const judgeMap = new Map(
				(judgeProfiles || []).map(profile => [profile.id, profile.full_name])
			);

			// スコアデータに検定員名をマージ
			exportData = trainingScores.map(score => ({
				created_at: score.created_at,
				bib: score.athlete?.bib_number || '',
				score: score.score,
				discipline: '研修',
				level: '',
				event_name: score.training_events?.name || '',
				judge_name: judgeMap.get(score.judge_id) || '不明'
			}));
		}
	} else {
		// 検定モード・大会モード: resultsから取得
		console.log('[Export API] 検定/大会モードの結果を取得中...');
		const { data, error: resultsError } = await supabase
			.from('results')
			.select('created_at, bib, score, discipline, level, event_name, judge_name')
			.eq('session_id', sessionIdNum)
			.order('created_at', { ascending: true });

		console.log('[Export API] 検定/大会モード結果:', { count: data?.length, error: resultsError });

		if (resultsError) {
			console.error('[Export API] Failed to fetch results:', resultsError);
			return json({ error: '結果の取得に失敗しました。' }, { status: 500 });
		}

		exportData = data || [];
	}

	console.log('[Export API] エクスポートデータ件数:', exportData.length);

	// Return the data as a JSON response
	return json({ results: exportData });
};
