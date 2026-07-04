import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { authenticateSession } from '$lib/server/sessionAuth';
import { computeScoreboardRankings } from '$lib/scoreboard';

export const load: PageServerLoad = async ({ params, locals: { supabase }, setHeaders }) => {
	// スコアボードは頻繁に更新されるため超短期キャッシュ（10秒）
	setHeaders({
		'cache-control': 'public, max-age=10, stale-while-revalidate=30'
	});

	const sessionId = params.id;

	// セッション認証（ログインユーザー専用）
	const { user } = await authenticateSession(supabase, sessionId, null);

	// セッション情報、種目一覧、採点結果、組織情報を並列取得（パフォーマンス最適化）
	const [sessionDetailsResult, eventsResult, resultsResult, orgMembersResult] = await Promise.all([
		supabase.from('sessions').select('id, name, is_tournament_mode').eq('id', sessionId).single(),
		supabase
			.from('custom_events')
			.select('id, discipline, level, event_name')
			.eq('session_id', sessionId)
			.order('display_order', { ascending: true }),
		supabase
			.from('results')
			.select('bib, score, discipline, level, event_name')
			.eq('session_id', sessionId)
			.limit(5000),
		supabase
			.from('organization_members')
			.select('organization_id')
			.eq('user_id', user.id)
			.is('removed_at', null)
	]);

	const sessionDetails = sessionDetailsResult.data;
	const events = eventsResult.data;
	const results = resultsResult.data;
	const orgMembers = orgMembersResult.data || [];

	if (sessionDetailsResult.error) {
		throw error(404, '大会が見つかりません。');
	}

	// 大会モードでない場合はエラー
	if (!sessionDetails.is_tournament_mode) {
		throw error(400, 'スコアボードは大会モードでのみ利用できます。');
	}

	if (eventsResult.error) {
		throw error(500, '種目情報の取得に失敗しました。');
	}

	if (resultsResult.error) {
		throw error(500, '採点結果の取得に失敗しました。');
	}

	// 組織所属チェック（組織バッジ表示用）
	const hasOrganization = orgMembers.length > 0;

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

	// ランキング集計（公開版スコアボードと共通の純粋関数）
	const { overallRanking, eventRankings } = computeScoreboardRankings(events, results);

	return {
		user,
		profile,
		hasOrganization,
		sessionDetails,
		events: events || [],
		overallRanking,
		eventRankings
	};
};
