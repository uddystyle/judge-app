import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 再監査（docs/stripe/stripe-audit-2026-08-05.md）の回帰テスト。
 *
 * いずれも「本番で課金が始まる前に閉じる」ことを目的とした欠陥で、
 * 前回監査（2026-08-04）の修正が別経路から迂回されていたものを含む。
 */

const { mockSupabaseClient, mockConstructEvent } = vi.hoisted(() => ({
	mockSupabaseClient: { from: vi.fn() },
	mockConstructEvent: vi.fn()
}));

vi.mock('$lib/server/stripe', () => ({
	stripe: {
		webhooks: {
			constructEvent: mockConstructEvent,
			constructEventAsync: vi.fn(async (...args: unknown[]) =>
				(mockConstructEvent as (...a: unknown[]) => unknown)(...args)
			)
		},
		subscriptions: { retrieve: vi.fn(), list: vi.fn(), cancel: vi.fn(), update: vi.fn() },
		customers: { create: vi.fn() },
		checkout: { sessions: { create: vi.fn() } },
		promotionCodes: { list: vi.fn() }
	}
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockSupabaseClient) }));
vi.mock('$env/static/private', () => ({
	STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
	STRIPE_SECRET_KEY: 'sk_test_mock_key',
	SUPABASE_SERVICE_ROLE_KEY: 'test_service_role_key',
	STRIPE_PRICE_BASIC_MONTH: 'price_basic_month',
	STRIPE_PRICE_BASIC_YEAR: 'price_basic_year',
	STRIPE_PRICE_STANDARD_MONTH: 'price_standard_month',
	STRIPE_PRICE_STANDARD_YEAR: 'price_standard_year',
	STRIPE_PRICE_PREMIUM_MONTH: 'price_premium_month',
	STRIPE_PRICE_PREMIUM_YEAR: 'price_premium_year'
}));
vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
	PUBLIC_SITE_URL: 'http://localhost:5173'
}));
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

import { POST as webhookPost } from '../../../routes/api/stripe/webhook/+server';
import { POST as upgradeOrganization } from '../../../routes/api/stripe/upgrade-organization/+server';
import { actions as changePlanActions } from '../../../routes/organization/[id]/change-plan/+page.server';
import { actions as deleteActions } from '../../../routes/organization/[id]/delete/+page.server';
import { stripe } from '$lib/server/stripe';

const PERIOD_START = 1640995200; // 2022-01-01
const PERIOD_END = 1643673600; // 2022-02-01

function cloverSubscription(overrides: Record<string, unknown> = {}) {
	return {
		id: 'sub_test_123',
		customer: 'cus_test_123',
		status: 'active',
		cancel_at_period_end: false,
		items: {
			data: [
				{
					id: 'si_1',
					current_period_start: PERIOD_START,
					current_period_end: PERIOD_END,
					price: { id: 'price_premium_month', recurring: { interval: 'month' } }
				}
			]
		},
		...overrides
	};
}

// ---------------------------------------------------------------- webhook 用

function createSupabaseMock(responses: Record<string, Array<{ data: unknown; error: unknown }>>) {
	const calls: Array<{
		table: string;
		update: ReturnType<typeof vi.fn>;
		upsert: ReturnType<typeof vi.fn>;
	}> = [];
	const queues: Record<string, Array<{ data: unknown; error: unknown }>> = {};
	for (const [k, v] of Object.entries(responses)) queues[k] = [...v];
	const takeSync = (table: string) => queues[table]?.shift() ?? { data: null, error: null };

	mockSupabaseClient.from.mockImplementation((table: string) => {
		const upsert = vi.fn(() => builder);
		const update = vi.fn(() => builder);
		const take = async () => queues[table]?.shift() ?? { data: null, error: null };
		const builder: any = {
			select: vi.fn(() => builder),
			insert: vi.fn(() => ({
				then: (resolve: any) => Promise.resolve(takeSync(table)).then(resolve)
			})),
			upsert,
			update,
			delete: vi.fn(() => builder),
			eq: vi.fn(() => builder),
			in: vi.fn(() => builder),
			neq: vi.fn(() => builder),
			lt: vi.fn(() => builder),
			order: vi.fn(() => builder),
			limit: vi.fn(() => builder),
			single: vi.fn(take),
			maybeSingle: vi.fn(take),
			then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
		};
		calls.push({ table, update, upsert });
		return builder;
	});

	return {
		updateArgs: (table: string) =>
			calls.filter((c) => c.table === table).flatMap((c) => c.update.mock.calls.map((a) => a[0]))
	};
}

function webhookRequest() {
	return {
		request: {
			headers: { get: (n: string) => (n === 'stripe-signature' ? 'sig' : null) },
			text: vi.fn().mockResolvedValue('body')
		}
	} as any;
}

function mockEvent(type: string, object: Record<string, unknown>) {
	mockConstructEvent.mockReturnValue({
		id: 'evt_audit',
		type,
		livemode: false,
		data: { object }
	} as any);
}

// ------------------------------------------------------- ページ/エンドポイント用

const createChainMock = (result: any) => {
	const chain: any = {};
	for (const m of [
		'select',
		'update',
		'upsert',
		'insert',
		'delete',
		'eq',
		'neq',
		'in',
		'is',
		'not',
		'or',
		'single',
		'maybeSingle',
		'order',
		'limit'
	]) {
		chain[m] = vi.fn(() => chain);
	}
	chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
	return chain;
};

/** テーブル名で応答を出し分ける admin クライアント（書き込み先の記録つき） */
const createAdminClientMock = (responses: Record<string, any> = {}) => {
	const calls: { table: string; chain: any }[] = [];
	const client = {
		from: vi.fn((table: string) => {
			const chain = createChainMock(responses[table] ?? { data: null, error: null });
			calls.push({ table, chain });
			return chain;
		})
	};
	const tablesWritten = (op: 'update' | 'delete' | 'insert' | 'upsert') =>
		calls.filter((c) => c.chain[op].mock.calls.length > 0).map((c) => c.table);
	return { client, calls, tablesWritten };
};

const createUserClient = (fromResults: any[]) => {
	const calls: { table: string; chain: any }[] = [];
	const client: any = {
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: { id: 'user_1', email: 'admin@example.com' } },
				error: null
			})
		},
		from: vi.fn()
	};
	for (const result of fromResults) {
		client.from.mockImplementationOnce((table: string) => {
			const chain = createChainMock(result);
			calls.push({ table, chain });
			return chain;
		});
	}
	client.from.mockImplementation((table: string) => {
		const chain = createChainMock({ data: null, error: null });
		calls.push({ table, chain });
		return chain;
	});
	const tablesWritten = (op: 'update' | 'delete' | 'insert' | 'upsert') =>
		calls.filter((c) => c.chain[op].mock.calls.length > 0).map((c) => c.table);
	return { client, calls, tablesWritten };
};

const formRequest = (fields: Record<string, string>) =>
	({
		formData: async () => ({ get: (k: string) => fields[k] ?? null })
	}) as unknown as Request;

// ============================================================================

describe('P0-B: customer.subscription.created の決済確定ゲート', () => {
	beforeEach(() => vi.clearAllMocks());

	it('決済未確定(incomplete)では organizations を有料プランに昇格させない', async () => {
		mockEvent('customer.subscription.created', cloverSubscription({ status: 'incomplete' }));
		const db = createSupabaseMock({
			subscriptions: [
				{
					data: { user_id: 'user_1', organization_id: 'org_1', current_period_end: null },
					error: null
				}
			],
			plan_limits: [{ data: { max_organization_members: 100 }, error: null }]
		});

		await webhookPost(webhookRequest());

		const orgUpdates = db.updateArgs('organizations');
		expect(orgUpdates.some((u: any) => u.plan_type === 'premium')).toBe(false);
	});

	it('active なら従来どおり昇格する', async () => {
		mockEvent('customer.subscription.created', cloverSubscription({ status: 'active' }));
		const db = createSupabaseMock({
			subscriptions: [
				{
					data: { user_id: 'user_1', organization_id: 'org_1', current_period_end: null },
					error: null
				}
			],
			plan_limits: [{ data: { max_organization_members: 100 }, error: null }]
		});

		await webhookPost(webhookRequest());

		const orgUpdates = db.updateArgs('organizations');
		expect(orgUpdates.some((u: any) => u.plan_type === 'premium')).toBe(true);
	});
});

describe('P2-G: customer.subscription.created の順序ガード', () => {
	beforeEach(() => vi.clearAllMocks());

	it('DB の方が新しい期間を持つ場合、遅延再送でプランを巻き戻さない', async () => {
		// created が3日遅れて届き、その間に年額へ変更済み（DB の period_end の方が新しい）
		mockEvent('customer.subscription.created', cloverSubscription({ status: 'active' }));
		const db = createSupabaseMock({
			subscriptions: [
				{
					data: {
						user_id: 'user_1',
						organization_id: 'org_1',
						current_period_start: new Date(PERIOD_START * 1000).toISOString(),
						current_period_end: new Date((PERIOD_END + 86400 * 365) * 1000).toISOString()
					},
					error: null
				}
			],
			plan_limits: [{ data: { max_organization_members: 100 }, error: null }]
		});

		await webhookPost(webhookRequest());

		expect(db.updateArgs('subscriptions')).toHaveLength(0);
		expect(db.updateArgs('organizations')).toHaveLength(0);
	});
});

describe('P2-H: リプレイ防御が期間短縮（年額→月額）を誤ってスキップしない', () => {
	beforeEach(() => vi.clearAllMocks());

	it('period_end が前倒しでも period_start が前進していれば正当な変更として反映する', async () => {
		// 年額(2022-01-01〜2023-01-01) → 月額(2022-06-01〜2022-07-01) へ anchor=now で変更
		const newStart = 1654041600; // 2022-06-01
		const newEnd = 1656633600; // 2022-07-01
		mockEvent(
			'customer.subscription.updated',
			cloverSubscription({
				status: 'active',
				items: {
					data: [
						{
							id: 'si_1',
							current_period_start: newStart,
							current_period_end: newEnd,
							price: { id: 'price_premium_month', recurring: { interval: 'month' } }
						}
					]
				}
			})
		);
		const db = createSupabaseMock({
			subscriptions: [
				{
					data: {
						organization_id: 'org_1',
						current_period_start: new Date(PERIOD_START * 1000).toISOString(),
						current_period_end: new Date(1672531200 * 1000).toISOString(), // 2023-01-01
						status: 'active',
						cancel_at_period_end: false,
						plan_type: 'premium',
						billing_interval: 'year'
					},
					error: null
				}
			],
			plan_limits: [{ data: { max_organization_members: 100 }, error: null }]
		});

		await webhookPost(webhookRequest());

		const subUpdates = db.updateArgs('subscriptions');
		expect(subUpdates.some((u: any) => u.billing_interval === 'month')).toBe(true);
	});

	it('本当に古いイベント（period_start も後退）は従来どおりスキップする', async () => {
		mockEvent(
			'customer.subscription.updated',
			cloverSubscription({
				status: 'active',
				items: {
					data: [
						{
							id: 'si_1',
							current_period_start: PERIOD_START - 86400 * 60,
							current_period_end: PERIOD_END - 86400 * 60,
							price: { id: 'price_premium_month', recurring: { interval: 'month' } }
						}
					]
				}
			})
		);
		const db = createSupabaseMock({
			subscriptions: [
				{
					data: {
						organization_id: 'org_1',
						current_period_start: new Date(PERIOD_START * 1000).toISOString(),
						current_period_end: new Date(PERIOD_END * 1000).toISOString(),
						status: 'active',
						cancel_at_period_end: false,
						plan_type: 'premium',
						billing_interval: 'month'
					},
					error: null
				}
			]
		});

		await webhookPost(webhookRequest());

		expect(db.updateArgs('subscriptions')).toHaveLength(0);
	});
});

describe('P2-E: invoice の支払い成功で status を固定書きしない', () => {
	beforeEach(() => vi.clearAllMocks());

	it('他の請求書が未払いで past_due のままなら active と書かない', async () => {
		mockEvent('invoice.paid', { id: 'in_1', subscription: 'sub_test_123' });
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(
			cloverSubscription({ status: 'past_due' }) as any
		);
		const db = createSupabaseMock({
			subscriptions: [
				{
					data: { current_period_end: null, status: 'past_due', cancel_at_period_end: false },
					error: null
				}
			]
		});

		await webhookPost(webhookRequest());

		const updates = db.updateArgs('subscriptions');
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({ status: 'past_due' });
	});
});

describe('P0-A: 重複契約ガード（二重課金の防止）', () => {
	beforeEach(() => vi.clearAllMocks());

	it('既にアクティブな契約がある組織では checkout を作らない', async () => {
		const { client: userClient } = createUserClient([
			// organizations
			{
				data: { id: 'org_1', name: 'Org', plan_type: 'premium', stripe_customer_id: 'cus_1' },
				error: null
			},
			// organization_members（admin判定）
			{ data: { role: 'admin' }, error: null }
		]);
		// 契約者本人ではない管理者からは RLS で見えない状況を模す。
		// service role なら見えるので、admin クライアント側にだけ契約を置く。
		const { client: adminClient } = createAdminClientMock({
			subscriptions: { data: { id: 1, stripe_subscription_id: 'sub_existing' }, error: null }
		});

		const call = upgradeOrganization({
			request: {
				json: async () => ({
					organizationId: 'org_1',
					planType: 'premium',
					billingInterval: 'month',
					returnUrl: 'http://localhost:5173/account',
					cancelUrl: 'http://localhost:5173/pricing'
				})
			},
			locals: { supabase: userClient, supabaseAdmin: adminClient }
		} as any);

		await expect(call).rejects.toMatchObject({ status: 409 });
		expect(vi.mocked(stripe.checkout.sessions.create)).not.toHaveBeenCalled();
	});
});

describe('P1-D: 増減判定は Stripe の price を正とする', () => {
	beforeEach(() => vi.clearAllMocks());

	it('organizations がドリフトしていても basic→standard は増額として日割り請求する', async () => {
		const { client: userClient } = createUserClient([
			// organizations: ドリフトして premium（実際の課金は basic）
			{
				data: { id: 'org_1', name: 'Org', plan_type: 'premium', stripe_subscription_id: 'sub_1' },
				error: null
			},
			{ data: { role: 'admin' }, error: null }
		]);
		const { client: adminClient } = createAdminClientMock({
			subscriptions: {
				data: {
					stripe_subscription_id: 'sub_1',
					plan_type: 'basic',
					billing_interval: 'month',
					status: 'active'
				},
				error: null
			},
			plan_limits: { data: { max_organization_members: 30 }, error: null }
		});

		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_1',
			items: {
				data: [{ id: 'si_1', price: { id: 'price_basic_month', recurring: { interval: 'month' } } }]
			}
		} as any);
		vi.mocked(stripe.subscriptions.update).mockResolvedValue(
			cloverSubscription({ id: 'sub_1', status: 'active' }) as any
		);

		// 成功時は redirect を throw するため握りつぶす
		await Promise.resolve(
			changePlanActions.changePlan({
				request: formRequest({ planType: 'standard', billingInterval: 'month' }),
				params: { id: 'org_1' },
				locals: { supabase: userClient, supabaseAdmin: adminClient }
			} as any)
		).catch(() => undefined);

		const args = vi.mocked(stripe.subscriptions.update).mock.calls[0]?.[1] as any;
		expect(args.proration_behavior).toBe('always_invoice');
	});
});

describe('P1-C: 組織削除の subscriptions 書き込みは service role で行う', () => {
	beforeEach(() => vi.clearAllMocks());

	it('subscriptions への update/delete が user client に流れない', async () => {
		const { client: userClient, tablesWritten: userWrites } = createUserClient([
			// organization_members（admin判定）
			{ data: { role: 'admin' }, error: null },
			// organizations（読み取り）
			{
				data: {
					id: 'org_1',
					stripe_customer_id: 'cus_1',
					stripe_subscription_id: 'sub_1'
				},
				error: null
			},
			// subscriptions（読み取り）
			{ data: [{ id: 1, stripe_subscription_id: 'sub_1', status: 'active' }], error: null }
		]);
		const { client: adminClient, tablesWritten: adminWrites } = createAdminClientMock({
			organizations: { data: { id: 'org_1' }, error: null },
			subscriptions: {
				data: [{ id: 1, stripe_subscription_id: 'sub_1', status: 'active' }],
				error: null
			}
		});
		vi.mocked(stripe.subscriptions.list).mockResolvedValue({ data: [] } as any);
		vi.mocked(stripe.subscriptions.cancel).mockResolvedValue({ id: 'sub_1' } as any);

		// 成功時は redirect を throw するため握りつぶす
		await Promise.resolve(
			deleteActions.delete({
				params: { id: 'org_1' },
				request: formRequest({ confirmName: 'Org' }),
				locals: { supabase: userClient, supabaseAdmin: adminClient }
			} as any)
		).catch(() => undefined);

		expect(userWrites('update')).not.toContain('subscriptions');
		expect(userWrites('delete')).not.toContain('subscriptions');
		expect(adminWrites('delete')).toContain('subscriptions');
	});
});
