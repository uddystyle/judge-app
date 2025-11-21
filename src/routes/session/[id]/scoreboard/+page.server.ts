import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const sessionId = params.id;

	// セッション情報を取得
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
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
	const { data: events, error: eventsError } = await supabase
		.from('custom_events')
		.select('*')
		.eq('session_id', sessionId)
		.order('display_order', { ascending: true });

	if (eventsError) {
		throw error(500, '種目情報の取得に失敗しました。');
	}

	// 全ての採点結果を取得（必要なカラムのみ、上限5000件）
	const { data: results, error: resultsError } = await supabase
		.from('results')
		.select('bib, score, discipline, level, event_name')
		.eq('session_id', sessionId)
		.limit(5000);

	if (resultsError) {
		throw error(500, '採点結果の取得に失敗しました。');
	}

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

	// プロフィールと組織情報を取得
	let profile = null;
	let organizations = [];

	if (user) {
		const { data: profileData } = await supabase
			.from('profiles')
			.select('*')
			.eq('id', user.id)
			.single();

		profile = profileData;

		const { data: orgData } = await supabase
			.from('organization_members')
			.select('organization_id, organizations(id, name)')
			.eq('user_id', user.id);

		organizations = orgData || [];
	}

	return {
		user,
		profile,
		organizations,
		sessionDetails,
		events: events || [],
		overallRanking,
		eventRankings: eventRankings || []
	};
};
