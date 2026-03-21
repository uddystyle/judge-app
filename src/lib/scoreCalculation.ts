/**
 * スコア計算の純粋関数
 *
 * 3つの計算モードをサポート:
 * 1. 大会モード（合計・5審3採）: 最高点と最低点を除外した3人の合計
 * 2. 大会モード（合計・3審3採）: 全員の合計
 * 3. 検定モード（平均）: 全員の平均（四捨五入）
 */

export type CalculateFinalScoreResult =
	| { success: true; finalScore: number }
	| { success: false; error: string };

export interface CalculateFinalScoreOptions {
	/** 合計点方式かどうか（false の場合は平均点方式） */
	useSum: boolean;
	/** 最高・最低点を除外するか（5審3採） */
	excludeExtremes: boolean;
	/** 点差の上限（null の場合はチェックしない） */
	maxScoreDiff?: number | null;
}

/**
 * 最終スコアを計算する
 *
 * @param rawScores - 各検定員のスコア配列（数値）
 * @param options - 計算オプション
 * @returns 計算結果（成功時は finalScore、失敗時は error メッセージ）
 */
export function calculateFinalScore(
	rawScores: number[],
	options: CalculateFinalScoreOptions
): CalculateFinalScoreResult {
	if (rawScores.length === 0) {
		return { success: false, error: '採点結果がありません。' };
	}

	const sorted = [...rawScores].sort((a, b) => a - b);

	// 点差チェック（大会モードで設定されている場合）
	if (options.maxScoreDiff != null && sorted.length >= 2) {
		const diff = Math.round(sorted[sorted.length - 1] - sorted[0]);
		if (diff > options.maxScoreDiff) {
			return {
				success: false,
				error: `点差が上限を超えています（${diff}点 > ${options.maxScoreDiff}点）。再採点を指示してください。`
			};
		}
	}

	if (options.useSum) {
		if (options.excludeExtremes) {
			// 5審3採: 最高・最低を除く3人の合計
			if (sorted.length < 5) {
				return {
					success: false,
					error: `5審3採では5人の採点が必要です。現在${sorted.length}人です。`
				};
			}
			const middleThree = sorted.slice(1, 4);
			return { success: true, finalScore: middleThree.reduce((sum, s) => sum + s, 0) };
		} else {
			// 3審3採: 全員の合計
			if (sorted.length < 3) {
				return {
					success: false,
					error: `3審3採では3人の採点が必要です。現在${sorted.length}人です。`
				};
			}
			return { success: true, finalScore: sorted.reduce((sum, s) => sum + s, 0) };
		}
	} else {
		// 平均点方式（検定モード）
		const total = sorted.reduce((sum, s) => sum + s, 0);
		return { success: true, finalScore: Math.round(total / sorted.length) };
	}
}
