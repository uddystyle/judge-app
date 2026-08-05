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
//
// ⚠️ 'pro' は廃止した（2026-08-04）。prod/dev いずれの CHECK 制約も
// plan_type に 'pro' を許可しておらず、plan_limits にも pro 行が無いため、
// 'pro' を返した時点で webhook は CHECK 違反 → 500 → Stripe が3日間再送、
// という復旧不能な状態に入る。旧個人proの契約が存在しないことは確認済み。
// 旧個人 pro の price ID は意図的にマッピングから外してある:
//   price_1SPHvrIsuW568CJsBsRymAvZ（月額）/ price_1SPHwCIsuW568CJsuuhrug0G（年額）
// 万一これらのイベントが届いた場合は「未知のprice ID」として明示的に失敗する
// （誤ったplan_typeを保存するより、気づける形で落とす方が安全）。
const PERSONAL_STANDARD_PRICES = [
	'price_1SPHtjIsuW568CJsdqnUsm9d', // 月額
	'price_1SPHurIsuW568CJsFfJ6kwYV' // 年額
];

/**
 * Price IDからプランタイプを判定する
 *
 * 組織プラン（環境変数由来）を先に、個人プラン（固定ID）を後に照合する。
 * 未知のPrice IDは null を返す（エラー化するかは呼び出し側の責務。
 * webhook は T2 対応として RetryableError に変換する）。
 *
 * 戻り値は必ず DB の plan_type CHECK 制約（free/basic/standard/premium）の
 * 部分集合であること。`plans.priceMapping.test.ts` がこの不変条件を守る。
 */
export function findPlanTypeByPriceId(priceId: string): 'standard' | 'basic' | 'premium' | null {
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
	}

	return null;
}
