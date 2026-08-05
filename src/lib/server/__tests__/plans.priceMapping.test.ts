import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		STRIPE_PRICE_BASIC_MONTH: 'price_basic_month',
		STRIPE_PRICE_BASIC_YEAR: 'price_basic_year',
		STRIPE_PRICE_STANDARD_MONTH: 'price_standard_month',
		STRIPE_PRICE_STANDARD_YEAR: 'price_standard_year',
		STRIPE_PRICE_PREMIUM_MONTH: 'price_premium_month',
		STRIPE_PRICE_PREMIUM_YEAR: 'price_premium_year'
	}
}));

import { findPlanTypeByPriceId, ORG_PRICE_IDS } from '$lib/server/plans';

/**
 * price ID → plan_type のマッピングは **DB の CHECK 制約と必ず一致していなければならない**。
 *
 * ⚠️ 背景: `findPlanTypeByPriceId` は旧個人プランの price に対して `'pro'` を返していたが、
 * prod/dev いずれの `subscriptions.plan_type` / `organizations.plan_type` の CHECK も
 * `'pro'` を許可しておらず、`plan_limits` にも `pro` 行が無い。
 * つまり `'pro'` が返った時点で webhook は CHECK 違反 → 500 → Stripe が3日間再送、という
 * 復旧不能な状態に入る。旧個人プランの契約は存在しない（2026-08-04 確認）ため廃止した。
 */

/**
 * DB の CHECK 制約が許可する plan_type（prod / dev 双方で同一・2026-08-04 実測）。
 *
 * ⚠️ この配列は**手書きの写し**なので、実DB側が変わってもこのテストは気づけない。
 * 実DB・環境変数・Stripe カタログとの突合は `npm run verify:plan-consistency`
 * （ネットワークが要るため CI のユニットテストからは分離）と、
 * CHECK 制約そのものは `database/migrations/verify/1029_verify_status_check.sql` が担当する。
 * ここで守るのは「コード側が DB の想定を超える値を返さない」という一方向の不変条件だけ。
 */
const DB_ALLOWED_PLAN_TYPES = ['free', 'basic', 'standard', 'premium'];

/** 旧個人プランの price ID（Stripe ダッシュボード上の固定ID） */
const LEGACY_PERSONAL_PRICE_IDS = [
	'price_1SPHtjIsuW568CJsdqnUsm9d', // 旧 個人standard 月額
	'price_1SPHurIsuW568CJsFfJ6kwYV', // 旧 個人standard 年額
	'price_1SPHvrIsuW568CJsBsRymAvZ', // 旧 個人pro 月額
	'price_1SPHwCIsuW568CJsuuhrug0G' // 旧 個人pro 年額
];

describe('findPlanTypeByPriceId と DB CHECK 制約の整合', () => {
	it('組織プランの price ID を正しいプランへ写す', () => {
		expect(findPlanTypeByPriceId(ORG_PRICE_IDS.basic.month)).toBe('basic');
		expect(findPlanTypeByPriceId(ORG_PRICE_IDS.basic.year)).toBe('basic');
		expect(findPlanTypeByPriceId(ORG_PRICE_IDS.standard.month)).toBe('standard');
		expect(findPlanTypeByPriceId(ORG_PRICE_IDS.standard.year)).toBe('standard');
		expect(findPlanTypeByPriceId(ORG_PRICE_IDS.premium.month)).toBe('premium');
		expect(findPlanTypeByPriceId(ORG_PRICE_IDS.premium.year)).toBe('premium');
	});

	it('未知の price ID は null を返す（呼び出し側でエラー化する）', () => {
		expect(findPlanTypeByPriceId('price_unknown')).toBeNull();
	});

	it('DBが受け付けない plan_type を返さない', () => {
		const allPriceIds = [
			...Object.values(ORG_PRICE_IDS).flatMap((p) => [p.month, p.year]),
			...LEGACY_PERSONAL_PRICE_IDS,
			'price_unknown'
		];

		for (const priceId of allPriceIds) {
			const planType = findPlanTypeByPriceId(priceId);
			if (planType !== null) {
				expect(DB_ALLOWED_PLAN_TYPES).toContain(planType);
			}
		}
	});

	it("廃止した個人proの price ID は 'pro' ではなく null を返す", () => {
		expect(findPlanTypeByPriceId('price_1SPHvrIsuW568CJsBsRymAvZ')).toBeNull();
		expect(findPlanTypeByPriceId('price_1SPHwCIsuW568CJsuuhrug0G')).toBeNull();
	});
});
