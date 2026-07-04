import { describe, it, expect } from 'vitest';
import { computeScoreboardRankings } from '$lib/scoreboard';
import type { ScoreboardEvent, ScoreboardResult } from '$lib/scoreboard';

const events: ScoreboardEvent[] = [
	{ id: 1, discipline: '大会', level: '共通', event_name: '大回り' },
	{ id: 2, discipline: '大会', level: '共通', event_name: '小回り' }
];

const result = (
	bib: number,
	score: number,
	event_name: string,
	discipline = '大会',
	level = '共通'
): ScoreboardResult => ({ bib, score, event_name, discipline, level });

describe('computeScoreboardRankings', () => {
	it('同一種目の複数検定員の得点をゼッケンごとに合計する', () => {
		const { eventRankings } = computeScoreboardRankings(events, [
			result(10, 80, '大回り'),
			result(10, 85, '大回り'),
			result(10, 78, '大回り')
		]);

		const ooMawari = eventRankings.find((e) => e.event_name === '大回り')!;
		expect(ooMawari.ranking).toEqual([{ rank: 1, bib: 10, score: 80 + 85 + 78 }]);
	});

	it('総合得点は種目別得点の合計になり、降順で順位が付く', () => {
		const { overallRanking } = computeScoreboardRankings(events, [
			result(10, 80, '大回り'),
			result(10, 70, '小回り'),
			result(20, 90, '大回り'),
			result(20, 85, '小回り')
		]);

		expect(overallRanking).toEqual([
			{ rank: 1, bib: 20, total_score: 175 },
			{ rank: 2, bib: 10, total_score: 150 }
		]);
	});

	it('種目別ランキングは、その種目を採点されたゼッケンのみを含む', () => {
		const { eventRankings } = computeScoreboardRankings(events, [
			result(10, 80, '大回り'),
			result(20, 75, '大回り'),
			result(20, 88, '小回り')
		]);

		const koMawari = eventRankings.find((e) => e.event_name === '小回り')!;
		expect(koMawari.ranking).toEqual([{ rank: 1, bib: 20, score: 88 }]);

		const ooMawari = eventRankings.find((e) => e.event_name === '大回り')!;
		expect(ooMawari.ranking).toEqual([
			{ rank: 1, bib: 10, score: 80 },
			{ rank: 2, bib: 20, score: 75 }
		]);
	});

	it('種目別ランキングは種目のメタ情報（event_id/discipline/level/event_name）を保持する', () => {
		const { eventRankings } = computeScoreboardRankings(events, [result(10, 80, '大回り')]);

		expect(eventRankings).toHaveLength(2);
		expect(eventRankings[0]).toMatchObject({
			event_id: 1,
			discipline: '大会',
			level: '共通',
			event_name: '大回り'
		});
	});

	it('同点の場合も順位は連番になる（現行仕様の維持）', () => {
		const { overallRanking } = computeScoreboardRankings(events, [
			result(10, 80, '大回り'),
			result(20, 80, '大回り')
		]);

		expect(overallRanking.map((r) => r.rank)).toEqual([1, 2]);
		expect(overallRanking.map((r) => r.total_score)).toEqual([80, 80]);
	});

	it('discipline/level が異なれば同名種目でも別種目として扱う', () => {
		const { overallRanking } = computeScoreboardRankings(events, [
			result(10, 80, '大回り', '大会', '共通'),
			result(10, 70, '大回り', '基礎', '1級')
		]);

		// 別 eventKey なので合計は 150（上書きされない）
		expect(overallRanking).toEqual([{ rank: 1, bib: 10, total_score: 150 }]);
	});

	it('results が null/空でも空のランキングを返す', () => {
		expect(computeScoreboardRankings(events, null)).toEqual({
			overallRanking: [],
			eventRankings: events.map((e) => ({
				event_id: e.id,
				discipline: e.discipline,
				level: e.level,
				event_name: e.event_name,
				ranking: []
			}))
		});
	});

	it('events が null でも空の種目別ランキングを返す', () => {
		const { overallRanking, eventRankings } = computeScoreboardRankings(null, [
			result(10, 80, '大回り')
		]);

		expect(eventRankings).toEqual([]);
		expect(overallRanking).toEqual([{ rank: 1, bib: 10, total_score: 80 }]);
	});
});
