/**
 * status ページの確定ボタン canSubmit（M4 ソフトゲート）の logic-mirror テスト。
 *
 * 実装（status/+page.svelte の canSubmit リアクティブ式）と同じ規則をミラー:
 *   - 研修(training): ソフトゲート。1件以上の採点 && 点差OK で確定可（必要審判数 N は問わない）
 *   - 大会/検定: 従来どおり scores.length >= requiredJudges && 点差OK
 */

import { describe, it, expect } from 'vitest';

function canSubmit(args: {
	isTrainingMode: boolean;
	scoreCount: number;
	requiredJudges: number | null;
	scoreDiffExceeded: boolean;
}): boolean {
	const { isTrainingMode, scoreCount, requiredJudges, scoreDiffExceeded } = args;
	const hasRequiredScores = isTrainingMode ? scoreCount >= 1 : scoreCount >= (requiredJudges || 1);
	return hasRequiredScores && !scoreDiffExceeded;
}

describe('status canSubmit（M4 ソフトゲート）', () => {
	describe('研修(training) ソフトゲート', () => {
		it('参加者5名でも1名採点で確定可（N に依存しない）', () => {
			expect(
				canSubmit({
					isTrainingMode: true,
					scoreCount: 1,
					requiredJudges: 5,
					scoreDiffExceeded: false
				})
			).toBe(true);
		});

		it('0件は確定不可', () => {
			expect(
				canSubmit({
					isTrainingMode: true,
					scoreCount: 0,
					requiredJudges: 5,
					scoreDiffExceeded: false
				})
			).toBe(false);
		});

		it('点差超過なら確定不可（1件以上でも）', () => {
			expect(
				canSubmit({
					isTrainingMode: true,
					scoreCount: 3,
					requiredJudges: 3,
					scoreDiffExceeded: true
				})
			).toBe(false);
		});
	});

	describe('大会/検定 ハードゲート（不変）', () => {
		it('必要数未満は確定不可', () => {
			expect(
				canSubmit({
					isTrainingMode: false,
					scoreCount: 2,
					requiredJudges: 3,
					scoreDiffExceeded: false
				})
			).toBe(false);
		});

		it('必要数到達で確定可', () => {
			expect(
				canSubmit({
					isTrainingMode: false,
					scoreCount: 3,
					requiredJudges: 3,
					scoreDiffExceeded: false
				})
			).toBe(true);
		});

		it('requiredJudges が null/0 のときは 1 にフォールバック', () => {
			expect(
				canSubmit({
					isTrainingMode: false,
					scoreCount: 1,
					requiredJudges: null,
					scoreDiffExceeded: false
				})
			).toBe(true);
			expect(
				canSubmit({
					isTrainingMode: false,
					scoreCount: 0,
					requiredJudges: 0,
					scoreDiffExceeded: false
				})
			).toBe(false);
		});

		it('必要数到達でも点差超過なら確定不可', () => {
			expect(
				canSubmit({
					isTrainingMode: false,
					scoreCount: 3,
					requiredJudges: 3,
					scoreDiffExceeded: true
				})
			).toBe(false);
		});
	});
});
