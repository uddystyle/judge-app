/**
 * スコアボードのランキング集計（純粋関数）
 *
 * 認証版（/session/[id]/scoreboard）と公開共有版（/scoreboard/[sessionId]）の
 * 両方から使用される。I/O を持たないため、データ取得・認証は各ルートが担当する。
 */

export interface ScoreboardEvent {
	id: number | string;
	discipline: string;
	level: string;
	event_name: string;
}

export interface ScoreboardResult {
	bib: number;
	score: number;
	discipline: string;
	level: string;
	event_name: string;
}

export interface OverallRankingEntry {
	rank: number;
	bib: number;
	total_score: number;
}

export interface EventRanking {
	event_id: number | string;
	discipline: string;
	level: string;
	event_name: string;
	ranking: Array<{ rank: number; bib: number; score: number }>;
}

/**
 * ゼッケン番号ごとに得点を集計し、総合ランキングと種目別ランキングを計算する
 *
 * - 同一種目に複数の検定員の採点がある場合は合計する
 * - 総合得点は種目ごとの得点の合計
 * - ランキングは得点降順、順位は 1 始まりの連番（同点でも順位は連番）
 */
export function computeScoreboardRankings(
	events: ScoreboardEvent[] | null | undefined,
	results: ScoreboardResult[] | null | undefined
): { overallRanking: OverallRankingEntry[]; eventRankings: EventRanking[] } {
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

		// 種目ごとの得点を累積（同じ種目で複数の検定員がいる場合は合計）
		bibData.events.set(eventKey, (bibData.events.get(eventKey) ?? 0) + score);
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
	const eventRankings =
		events?.map((event) => {
			const eventKey = `${event.discipline}-${event.level}-${event.event_name}`;

			const ranking = Array.from(bibScores.entries())
				.filter(([, data]) => data.events.has(eventKey))
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
		}) ?? [];

	return { overallRanking, eventRankings };
}
