import { describe, it, expect } from 'vitest';
import { calculateFinalScore } from '$lib/scoreCalculation';

describe('calculateFinalScore', () => {
	describe('空のスコア', () => {
		it('空配列の場合エラーを返す', () => {
			const result = calculateFinalScore([], { useSum: true, excludeExtremes: false });
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('採点結果がありません');
			}
		});
	});

	describe('合計点方式（3審3採）', () => {
		it('3人の合計を計算する', () => {
			const result = calculateFinalScore([70, 75, 80], { useSum: true, excludeExtremes: false });
			expect(result).toEqual({ success: true, finalScore: 225 });
		});

		it('5人いても全員の合計を計算する', () => {
			const result = calculateFinalScore([60, 70, 75, 80, 90], {
				useSum: true,
				excludeExtremes: false
			});
			expect(result).toEqual({ success: true, finalScore: 375 });
		});

		it('3人未満の場合エラーを返す', () => {
			const result = calculateFinalScore([70, 75], { useSum: true, excludeExtremes: false });
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('3審3採では3人の採点が必要');
			}
		});
	});

	describe('合計点方式（5審3採）', () => {
		it('最高・最低を除いた3人の合計を計算する', () => {
			const result = calculateFinalScore([60, 70, 75, 80, 90], {
				useSum: true,
				excludeExtremes: true
			});
			// sorted: [60, 70, 75, 80, 90] → middle: [70, 75, 80] → 225
			expect(result).toEqual({ success: true, finalScore: 225 });
		});

		it('5人未満の場合エラーを返す', () => {
			const result = calculateFinalScore([70, 75, 80, 85], {
				useSum: true,
				excludeExtremes: true
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('5審3採では5人の採点が必要');
			}
		});
	});

	describe('平均点方式（検定モード）', () => {
		it('平均点を四捨五入して返す', () => {
			const result = calculateFinalScore([70, 75, 80], {
				useSum: false,
				excludeExtremes: false
			});
			// (70 + 75 + 80) / 3 = 75
			expect(result).toEqual({ success: true, finalScore: 75 });
		});

		it('小数点以下を四捨五入する', () => {
			const result = calculateFinalScore([70, 71], { useSum: false, excludeExtremes: false });
			// (70 + 71) / 2 = 70.5 → 71
			expect(result).toEqual({ success: true, finalScore: 71 });
		});

		it('1人でも計算できる', () => {
			const result = calculateFinalScore([85], { useSum: false, excludeExtremes: false });
			expect(result).toEqual({ success: true, finalScore: 85 });
		});
	});

	describe('点差チェック', () => {
		it('点差が上限以内の場合は成功する', () => {
			const result = calculateFinalScore([70, 75, 80], {
				useSum: true,
				excludeExtremes: false,
				maxScoreDiff: 15
			});
			expect(result.success).toBe(true);
		});

		it('点差が上限を超える場合エラーを返す', () => {
			const result = calculateFinalScore([60, 75, 90], {
				useSum: true,
				excludeExtremes: false,
				maxScoreDiff: 10
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('点差が上限を超えています');
				expect(result.error).toContain('30点 > 10点');
			}
		});

		it('maxScoreDiff が null の場合はチェックしない', () => {
			const result = calculateFinalScore([10, 90, 50], {
				useSum: true,
				excludeExtremes: false,
				maxScoreDiff: null
			});
			expect(result.success).toBe(true);
		});

		it('maxScoreDiff が undefined の場合はチェックしない', () => {
			const result = calculateFinalScore([10, 90, 50], {
				useSum: true,
				excludeExtremes: false
			});
			expect(result.success).toBe(true);
		});
	});
});
