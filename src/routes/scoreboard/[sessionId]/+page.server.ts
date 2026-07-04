import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { computeScoreboardRankings } from '$lib/scoreboard';

export const load: PageServerLoad = async ({ params, locals: { supabaseAdmin } }) => {
	const sessionId = params.sessionId;

	// 公開ページ（認証不要）。anon の sessions 全読みを塞いだため、表示用データは service role で取得する。
	// join_code / invite_token などの機微列は取得しない（公開ページに載せない）。
	if (!supabaseAdmin) {
		throw error(500, 'サーバー設定エラーによりスコアボードを表示できません。');
	}

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabaseAdmin
		.from('sessions')
		.select('id, name, is_tournament_mode')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		throw error(404, '大会が見つかりません。');
	}

	// 大会モードでない場合はエラー
	if (!sessionDetails.is_tournament_mode) {
		throw error(400, 'スコアボードは大会モードでのみ利用できます。');
	}

	// 種目一覧を取得
	const { data: events, error: eventsError } = await supabaseAdmin
		.from('custom_events')
		.select('*')
		.eq('session_id', sessionId)
		.order('display_order', { ascending: true });

	if (eventsError) {
		throw error(500, '種目情報の取得に失敗しました。');
	}

	// 全ての採点結果を取得
	const { data: results, error: resultsError } = await supabaseAdmin
		.from('results')
		.select('*')
		.eq('session_id', sessionId);

	if (resultsError) {
		throw error(500, '採点結果の取得に失敗しました。');
	}

	// ランキング集計（認証版スコアボードと共通の純粋関数）
	const { overallRanking, eventRankings } = computeScoreboardRankings(events, results);

	return {
		sessionDetails,
		events: events || [],
		overallRanking,
		eventRankings
	};
};
