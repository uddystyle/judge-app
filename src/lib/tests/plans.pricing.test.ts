import { describe, it, expect } from 'vitest';
import { ORG_PLANS, getPlanPrice, type OrgPlanId } from '$lib/plans';

/**
 * 表示価格の不変条件
 *
 * ⚠️ 背景: 課金額は Stripe の Price ID（$lib/server/plans.ts）で決まり、画面表示は
 * ORG_PLANS の数値という**別ソース**から出ている。両者が同期していないと
 * 「表示より高く請求される」状態になる（実際に年額で全プランがズレていた）。
 *
 * ここでは「年額＝月額10ヶ月分（＝2ヶ月分無料）」という値付けルールを固定する。
 * Stripe 側の price は 3 プランとも月額×10 ちょうどで作られており、この規則が正本。
 * 価格を変える時は Stripe の Price を作り直したうえでここも更新すること。
 *
 * Stripe の実価格との突合は `npm run verify:stripe-prices` で行う（ネットワーク必要）。
 */

const PLAN_IDS: OrgPlanId[] = ['basic', 'standard', 'premium'];

/** 年払いで無料になる月数（＝12 - 10） */
const FREE_MONTHS = 2;
const BILLED_MONTHS = 12 - FREE_MONTHS;

describe('組織プランの表示価格', () => {
	it.each(PLAN_IDS)('%s: 年額は月額の10ヶ月分（2ヶ月分無料）', (planId) => {
		const plan = ORG_PLANS[planId];
		expect(plan.yearlyPrice).toBe(plan.monthlyPrice * BILLED_MONTHS);
	});

	it('Stripe に登録されている実価格と一致する（2026-08-04 実測値の固定）', () => {
		// テストモードの price を API で実照合した値。Stripe 側を変えたらここも更新する。
		expect(ORG_PLANS.basic.monthlyPrice).toBe(8800);
		expect(ORG_PLANS.basic.yearlyPrice).toBe(88000);
		expect(ORG_PLANS.standard.monthlyPrice).toBe(24800);
		expect(ORG_PLANS.standard.yearlyPrice).toBe(248000);
		expect(ORG_PLANS.premium.monthlyPrice).toBe(49800);
		expect(ORG_PLANS.premium.yearlyPrice).toBe(498000);
	});

	it('割引率は全プランで同一（上位プランほど深い割引にならない）', () => {
		const rates = PLAN_IDS.map((id) => {
			const p = ORG_PLANS[id];
			return 1 - p.yearlyPrice / (p.monthlyPrice * 12);
		});

		for (const rate of rates) {
			expect(rate).toBeCloseTo(rates[0], 10);
		}
		// 念のため実値も確認（2ヶ月分＝約16.7%）
		expect(rates[0]).toBeCloseTo(FREE_MONTHS / 12, 10);
	});

	it('上位プランほど高い（月額・年額とも順序が保たれる）', () => {
		expect(ORG_PLANS.basic.monthlyPrice).toBeLessThan(ORG_PLANS.standard.monthlyPrice);
		expect(ORG_PLANS.standard.monthlyPrice).toBeLessThan(ORG_PLANS.premium.monthlyPrice);
		expect(ORG_PLANS.basic.yearlyPrice).toBeLessThan(ORG_PLANS.standard.yearlyPrice);
		expect(ORG_PLANS.standard.yearlyPrice).toBeLessThan(ORG_PLANS.premium.yearlyPrice);
	});

	it('月額と年額のティア倍率が一致する（年払いでティア差が圧縮されない）', () => {
		const monthlyRatio = ORG_PLANS.premium.monthlyPrice / ORG_PLANS.standard.monthlyPrice;
		const yearlyRatio = ORG_PLANS.premium.yearlyPrice / ORG_PLANS.standard.yearlyPrice;
		expect(yearlyRatio).toBeCloseTo(monthlyRatio, 10);
	});

	it('getPlanPrice が interval に応じた値を返す', () => {
		expect(getPlanPrice('basic', 'month')).toBe(8800);
		expect(getPlanPrice('basic', 'year')).toBe(88000);
	});
});
