/**
 * finalize 必要採点数ゲート（M1/M2）の logic-mirror テスト。
 *
 * 実装（サーバ側 finalizeScore のゲート）と同じ規則をミラーして回帰検知する:
 *  - 大会(tournament): exclude_extremes ? 5 : 3  （3審3採 / 5審3採）
 *  - 検定(certification): isMultiJudge ? (required_judges || 1) : 1  （主任設定。single-judge は 1）
 *  - finalize 可否: scores.length >= requiredCount
 *
 * 対応コード:
 *  - src/routes/session/[id]/score/[modeType]/[eventId]/status/+page.server.ts（大会 finalizeScore）
 *  - src/routes/session/[id]/[discipline]/[level]/[event]/score/status/+page.server.ts（検定 finalizeScore）
 *  - src/routes/api/score-status/[sessionId]/[bib]/+server.ts（realtime 用の必要数算出）
 */

import { describe, it, expect } from 'vitest';

type Ctx = {
	isTournament: boolean;
	excludeExtremes?: boolean;
	isMultiJudge?: boolean;
	requiredJudges?: number | null;
};

// 実装と同一の単一ルール
function requiredCount(ctx: Ctx): number {
	if (ctx.isTournament) {
		return ctx.excludeExtremes ? 5 : 3;
	}
	return ctx.isMultiJudge ? ctx.requiredJudges || 1 : 1;
}

const canFinalize = (scoreCount: number, req: number) => scoreCount >= req;

describe('finalize 必要採点数（M1/M2）', () => {
	describe('大会(tournament)', () => {
		it('3審3採: 2名では確定不可、3名で可', () => {
			const req = requiredCount({ isTournament: true, excludeExtremes: false });
			expect(req).toBe(3);
			expect(canFinalize(2, req)).toBe(false);
			expect(canFinalize(3, req)).toBe(true);
		});

		it('5審3採: 4名では確定不可、5名で可', () => {
			const req = requiredCount({ isTournament: true, excludeExtremes: true });
			expect(req).toBe(5);
			expect(canFinalize(4, req)).toBe(false);
			expect(canFinalize(5, req)).toBe(true);
		});

		it('大会は required_judges を参照しない（3/5 慣習が優先）', () => {
			const req = requiredCount({
				isTournament: true,
				excludeExtremes: false,
				isMultiJudge: true,
				requiredJudges: 2
			});
			expect(req).toBe(3);
		});
	});

	describe('検定(certification)', () => {
		it('multi-judge required_judges=2: 1名では不可、2名で可', () => {
			const req = requiredCount({ isTournament: false, isMultiJudge: true, requiredJudges: 2 });
			expect(req).toBe(2);
			expect(canFinalize(1, req)).toBe(false);
			expect(canFinalize(2, req)).toBe(true);
		});

		it('multi-judge required_judges=3: 1〜2名では不可、3名で可', () => {
			const req = requiredCount({ isTournament: false, isMultiJudge: true, requiredJudges: 3 });
			expect(req).toBe(3);
			expect(canFinalize(2, req)).toBe(false);
			expect(canFinalize(3, req)).toBe(true);
		});

		it('single-judge: 1名で確定可（人数ゲート無し）', () => {
			const req = requiredCount({ isTournament: false, isMultiJudge: false });
			expect(req).toBe(1);
			expect(canFinalize(1, req)).toBe(true);
		});

		it('required_judges が null/0 のときは 1 にフォールバック', () => {
			expect(requiredCount({ isTournament: false, isMultiJudge: true, requiredJudges: null })).toBe(
				1
			);
			expect(requiredCount({ isTournament: false, isMultiJudge: true, requiredJudges: 0 })).toBe(1);
		});
	});

	it('採点0件は常に確定不可（scores.length === 0 ガードと整合）', () => {
		expect(canFinalize(0, requiredCount({ isTournament: true, excludeExtremes: false }))).toBe(
			false
		);
		expect(canFinalize(0, requiredCount({ isTournament: false, isMultiJudge: false }))).toBe(false);
	});
});
