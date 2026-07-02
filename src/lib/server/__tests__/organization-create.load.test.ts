import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Stripe（promotionCodesのみ提供。coupons.retrieveの直接参照が残っていれば失敗する）
vi.mock('$lib/server/stripe', () => ({
	stripe: {
		promotionCodes: {
			list: vi.fn()
		}
	}
}));

// Import after mocks
import { load } from '../../../routes/organization/create/+page.server';
import { stripe } from '$lib/server/stripe';

/**
 * Supabaseクエリビルダーのチェーン可能なthenableモック
 */
const createChainMock = (result: any) => {
	const chain: any = {};
	const methods = [
		'select', 'update', 'upsert', 'insert', 'delete',
		'eq', 'neq', 'in', 'is', 'not', 'or',
		'single', 'maybeSingle', 'order', 'limit'
	];
	for (const m of methods) {
		chain[m] = vi.fn(() => chain);
	}
	chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
	return chain;
};

const createMockLocals = () => ({
	supabase: {
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			})
		},
		from: vi.fn(() => createChainMock({ data: null, error: null, count: 0 }))
	}
});

describe('組織作成ページのクーポンバッジ（SEC-2）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('URLの?coupon=はpromotion codeとして解決され、割引情報を返す', async () => {
		vi.mocked(stripe.promotionCodes.list).mockResolvedValue({
			data: [
				{
					id: 'promo_abc123',
					active: true,
					coupon: { id: 'coupon_internal', percent_off: 20, amount_off: null, currency: null }
				}
			]
		} as any);

		const locals = createMockLocals();
		const url = new URL('http://localhost:5173/organization/create?coupon=SPRING2026');

		const result: any = await load({ locals, url } as any);

		expect(stripe.promotionCodes.list).toHaveBeenCalledWith(
			expect.objectContaining({ code: 'SPRING2026', active: true })
		);
		expect(result.coupon).toEqual(
			expect.objectContaining({
				id: 'SPRING2026', // checkout側で再解決するため、入力コードをそのまま返す
				percentOff: 20
			})
		);
	});

	it('有効なpromotion codeが存在しない場合はcouponがnullになる（coupon ID直接参照の防止）', async () => {
		vi.mocked(stripe.promotionCodes.list).mockResolvedValue({ data: [] } as any);

		const locals = createMockLocals();
		const url = new URL('http://localhost:5173/organization/create?coupon=internal_coupon_id');

		const result: any = await load({ locals, url } as any);

		expect(result.coupon).toBeNull();
	});

	it('クーポン未指定の場合はStripeに問い合わせない', async () => {
		const locals = createMockLocals();
		const url = new URL('http://localhost:5173/organization/create');

		const result: any = await load({ locals, url } as any);

		expect(stripe.promotionCodes.list).not.toHaveBeenCalled();
		expect(result.coupon).toBeNull();
	});
});
