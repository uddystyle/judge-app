import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase }, setHeaders }) => {
	// スコアボードは頻繁に更新されるため超短期キャッシュ（10秒）
	setHeaders({
		'cache-control': 'public, max-age=10, stale-while-revalidate=30'
	});

	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const sessionId = params.id;

	// セッション情報、種目一覧、採点結果、組織情報を並列取得（パフォーマンス最適化）
	const [sessionDetailsResult, eventsResult, resultsResult, orgMembersResult] = await Promise.all([
		supabase.from('sessions').select('*').eq('id', sessionId).single(),
		supabase
			.from('custom_events')
			.select('*')
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

	// ゼッケン番号ごとに得点を集計
	const bibScores = new Map<number, { total: number; events: Map<string, number> }>();

	results?.forEach((result) => {
		const bib = result.bib;
		const eventKey = `${result.discipline}-${result.level}-${result.event_name}`;
		const score = result.score;

		if (!bibScores.has(bib)) {
			bibScores.set(bib, { total: 0, events: new Map() });
		}

		const bibData = bibScores.get(bib)!;

		// 種目ごとの得点を保存
		if (!bibData.events.has(eventKey)) {
			bibData.events.set(eventKey, 0);
		}

		// 種目ごとの得点を累積（同じ種目で複数の検定員がいる場合は合計）
		bibData.events.set(eventKey, bibData.events.get(eventKey)! + score);
	});

	// 種目ごとの得点を合計して総合得点を計算
	bibScores.forEach((bibData) => {
		bibData.total = Array.from(bibData.events.values()).reduce((sum, score) => sum + score, 0);
	});

	// 総合ランキングを作成
	const overallRanking = Array.from(bibScores.entries())
		.map(([bib, data]) => ({
			rank: 0,
			bib,
			total_score: data.total
		}))
		.sort((a, b) => b.total_score - a.total_score);

	// 順位を設定
	overallRanking.forEach((item, index) => {
		item.rank = index + 1;
	});

	// 種目別ランキングを作成
	const eventRankings = events?.map((event) => {
		const eventKey = `${event.discipline}-${event.level}-${event.event_name}`;

		const ranking = Array.from(bibScores.entries())
			.filter(([_, data]) => data.events.has(eventKey))
			.map(([bib, data]) => ({
				rank: 0,
				bib,
				score: data.events.get(eventKey)!
			}))
			.sort((a, b) => b.score - a.score);

		// 順位を設定
		ranking.forEach((item, index) => {
			item.rank = index + 1;
		});

		return {
			event_id: event.id,
			discipline: event.discipline,
			level: event.level,
			event_name: event.event_name,
			ranking
		};
	});

	return {
		user,
		hasOrganization,
		sessionDetails,
		events: events || [],
		overallRanking,
		eventRankings: eventRankings || []
	};
};
