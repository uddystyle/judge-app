import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/stripe', () => ({
	stripe: { subscriptions: { retrieve: vi.fn(), list: vi.fn() } }
}));

vi.mock('$lib/server/orgAuth', () => ({ isOrgAdmin: vi.fn(async () => true) }));

import { load } from './+page.server';
import { stripe } from '$lib/server/stripe';

/** チェーン可能なクエリモック。single() / await のどちらでも result を返す */
function makeChain(result: unknown = { data: null, error: null }) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const c: any = {};
	for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
		c[m] = vi.fn(() => c);
	}
	c.single = vi.fn(async () => result);
	return c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSupabase(queues: Record<string, any[]>) {
	return {
		auth: {
			getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }))
		},
		from: vi.fn((table: string) => {
			const q = queues[table];
			if (!q || q.length === 0) throw new Error(`unexpected from(${table})`);
			return q.length > 1 ? q.shift() : q[0];
		})
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeEvent = (supabase: any) => ({ params: { id: 'org-1' }, locals: { supabase } }) as any;

/**
 * pin 中の API バージョン 2025-10-29.clover では期間フィールドが items.data[] にのみ存在する。
 * 旧形状しか読めないと `new Date(undefined * 1000).toISOString()` が RangeError を投げ、
 * その例外が catch に飲まれて「解約期限が表示されない」状態になる。
 */
const CLOVER_SUBSCRIPTION = {
	id: 'sub_1',
	status: 'active',
	items: {
		data: [
			{
				id: 'si_1',
				current_period_start: 1640995200, // 2022-01-01T00:00:00.000Z
				current_period_end: 1643673600 // 2022-02-01T00:00:00.000Z
			}
		]
	}
};

describe('organization/[id]/delete load のサブスクリプション期限表示', () => {
	beforeEach(() => vi.clearAllMocks());

	it('stripe_subscription_id 経由: clover形状でも解約期限を返す', async () => {
		const supabase = makeSupabase({
			organizations: [
				makeChain({
					data: {
						id: 'org-1',
						name: 'Org',
						plan_type: 'basic',
						stripe_customer_id: null,
						stripe_subscription_id: 'sub_1'
					},
					error: null
				})
			],
			// DB 側にはレコードが無く、Stripe へフォールバックする経路
			subscriptions: [makeChain({ data: null, error: null })]
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(CLOVER_SUBSCRIPTION as any);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await load(makeEvent(supabase));

		expect(result.hasActiveSubscription).toBe(true);
		expect(result.subscriptionEndDate).toBe('2022-02-01T00:00:00.000Z');
	});

	it('stripe_customer_id 経由: clover形状でも解約期限を返す', async () => {
		const supabase = makeSupabase({
			organizations: [
				makeChain({
					data: {
						id: 'org-1',
						name: 'Org',
						plan_type: 'basic',
						stripe_customer_id: 'cus_1',
						stripe_subscription_id: null
					},
					error: null
				})
			],
			subscriptions: [makeChain({ data: null, error: null })]
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(stripe.subscriptions.list).mockResolvedValue({ data: [CLOVER_SUBSCRIPTION] } as any);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await load(makeEvent(supabase));

		expect(result.hasActiveSubscription).toBe(true);
		expect(result.subscriptionEndDate).toBe('2022-02-01T00:00:00.000Z');
	});
});
