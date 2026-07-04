/**
 * 組織プランの表示用カタログ（単一ソース）
 *
 * 価格・メンバー/検定員上限・機能一覧はここだけで定義する。
 * サーバー側の上限値（$lib/server/plans.ts の MAX_MEMBERS）もここから導出される。
 * Stripe Price ID との対応はサーバー専用の $lib/server/plans.ts が持つ。
 */

export type OrgPlanId = 'basic' | 'standard' | 'premium';

export interface OrgPlan {
	name: string;
	maxMembers: number;
	maxJudges: number;
	monthlyPrice: number;
	yearlyPrice: number;
	features: string[];
}

export const ORG_PLANS: Record<OrgPlanId, OrgPlan> = {
	basic: {
		name: 'Basic',
		maxMembers: 10,
		maxJudges: 15,
		monthlyPrice: 8800,
		yearlyPrice: 70000,
		features: [
			'組織メンバー10名まで',
			'検定員15名まで',
			'セッション無制限',
			'検定・大会・研修モード'
		]
	},
	standard: {
		name: 'Standard',
		maxMembers: 30,
		maxJudges: 50,
		monthlyPrice: 24800,
		yearlyPrice: 180000,
		features: [
			'組織メンバー30名まで',
			'検定員50名まで',
			'セッション無制限',
			'検定・大会・研修モード'
		]
	},
	premium: {
		name: 'Premium',
		maxMembers: 100,
		maxJudges: 100,
		monthlyPrice: 49800,
		yearlyPrice: 300000,
		features: [
			'組織メンバー100名まで',
			'検定員100名まで',
			'セッション無制限',
			'検定・大会・研修モード'
		]
	}
};

/** 請求間隔に応じたプラン価格を返す */
export function getPlanPrice(plan: OrgPlanId, interval: 'month' | 'year'): number {
	return interval === 'month' ? ORG_PLANS[plan].monthlyPrice : ORG_PLANS[plan].yearlyPrice;
}

/** 日本円表示（例: ￥8,800） */
export function formatPrice(price: number): string {
	return new Intl.NumberFormat('ja-JP', {
		style: 'currency',
		currency: 'JPY'
	}).format(price);
}
