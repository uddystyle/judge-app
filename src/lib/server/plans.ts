import { env } from '$env/dynamic/private';
import { ORG_PLANS } from '$lib/plans';

/**
 * プラン↔Stripe Price ID↔上限のマッピング（単一ソース）
 *
 * ここが唯一の定義場所。checkout 系エンドポイント・組織作成 API・webhook は
 * 必ずこのモジュールを参照する（コピーを作らないこと）。
 */

// Stripe Price IDのマッピング（組織プラン）
// 注意: 実際のPrice IDはStripeダッシュボードで作成後、環境変数に設定してください
export const ORG_PRICE_IDS: Record<string, { month: string; year: string }> = {
	basic: {
		month: env.STRIPE_PRICE_BASIC_MONTH || 'price_basic_month_placeholder',
		year: env.STRIPE_PRICE_BASIC_YEAR || 'price_basic_year_placeholder'
	},
	standard: {
		month: env.STRIPE_PRICE_STANDARD_MONTH || 'price_standard_month_placeholder',
		year: env.STRIPE_PRICE_STANDARD_YEAR || 'price_standard_year_placeholder'
	},
	premium: {
		month: env.STRIPE_PRICE_PREMIUM_MONTH || 'price_premium_month_placeholder',
		year: env.STRIPE_PRICE_PREMIUM_YEAR || 'price_premium_year_placeholder'
	}
};

// プランの最大メンバー数（表示用カタログ $lib/plans.ts から導出）
export const MAX_MEMBERS: Record<string, number> = Object.fromEntries(
	Object.entries(ORG_PLANS).map(([planId, plan]) => [planId, plan.maxMembers])
);

// 個人向けプラン（レガシー）のPrice ID。Stripeダッシュボード上の固定ID
const PERSONAL_STANDARD_PRICES = [
	'price_1SPHtjIsuW568CJsdqnUsm9d', // 月額
	'price_1SPHurIsuW568CJsFfJ6kwYV' // 年額
];

const PERSONAL_PRO_PRICES = [
	'price_1SPHvrIsuW568CJsBsRymAvZ', // 月額
	'price_1SPHwCIsuW568CJsuuhrug0G' // 年額
];

/**
 * Price IDからプランタイプを判定する
 *
 * 組織プラン（環境変数由来）を先に、個人プラン（固定ID）を後に照合する。
 * 未知のPrice IDは null を返す（エラー化するかは呼び出し側の責務。
 * webhook は T2 対応として RetryableError に変換する）。
 */
export function findPlanTypeByPriceId(
	priceId: string
): 'standard' | 'pro' | 'basic' | 'premium' | null {
	const basicPrices = [ORG_PRICE_IDS.basic.month, ORG_PRICE_IDS.basic.year];
	const orgStandardPrices = [ORG_PRICE_IDS.standard.month, ORG_PRICE_IDS.standard.year];
	const premiumPrices = [ORG_PRICE_IDS.premium.month, ORG_PRICE_IDS.premium.year];

	if (basicPrices.includes(priceId)) {
		return 'basic';
	} else if (orgStandardPrices.includes(priceId)) {
		return 'standard';
	} else if (premiumPrices.includes(priceId)) {
		return 'premium';
	} else if (PERSONAL_STANDARD_PRICES.includes(priceId)) {
		return 'standard';
	} else if (PERSONAL_PRO_PRICES.includes(priceId)) {
		return 'pro';
	}

	return null;
}
