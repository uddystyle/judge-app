import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 監査（docs/stripe/stripe-audit-2026-08-04.md）の H-1 / H-2 / M-1 / M-5 の回帰テスト。
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
		subscriptions: { retrieve: vi.fn(), list: vi.fn(), cancel: vi.fn() }
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
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }));
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

import { POST } from '../../../routes/api/stripe/webhook/+server';
import { stripe } from '$lib/server/stripe';

const PERIOD_START = 1640995200;
const PERIOD_END = 1643673600;

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

/**
 * テーブルごとに応答を差し替えられる PostgREST 風モック。
 * `responses[table]` が配列なら single()/maybeSingle() が先頭から消費する。
 */
function createSupabaseMock(responses: Record<string, Array<{ data: unknown; error: unknown }>>) {
	const calls: Array<{
		table: string;
		upsert: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
		filters: Array<[string, unknown]>;
	}> = [];
	const queues: Record<string, Array<{ data: unknown; error: unknown }>> = {};
	for (const [k, v] of Object.entries(responses)) queues[k] = [...v];
	const take2 = (table: string) => queues[table]?.shift() ?? { data: null, error: null };

	mockSupabaseClient.from.mockImplementation((table: string) => {
		const upsert = vi.fn(() => builder);
		const update = vi.fn(() => builder);
		const filters: Array<[string, unknown]> = [];
		const take = async () => queues[table]?.shift() ?? { data: null, error: null };
		const builder: any = {
			select: vi.fn(() => builder),
			insert: vi.fn(() => ({
				then: (resolve: any) => Promise.resolve(take2(table)).then(resolve)
			})),
			upsert,
			update,
			delete: vi.fn(() => builder),
			eq: vi.fn((col: string, val: unknown) => {
				filters.push([col, val]);
				return builder;
			}),
			in: vi.fn(() => builder),
			neq: vi.fn(() => builder),
			order: vi.fn(() => builder),
			limit: vi.fn(() => builder),
			single: vi.fn(take),
			maybeSingle: vi.fn(take),
			then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
		};
		calls.push({ table, upsert, update, filters });
		return builder;
	});

	return {
		calls,
		updateArgs: (table: string) =>
			calls.filter((c) => c.table === table).flatMap((c) => c.update.mock.calls.map((a) => a[0])),
		upsertArgs: (table: string) =>
			calls.filter((c) => c.table === table).flatMap((c) => c.upsert.mock.calls.map((a) => a[0])),
		filtersFor: (table: string) => calls.filter((c) => c.table === table).map((c) => c.filters)
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
		id: 'evt_test_123',
		type,
		livemode: false,
		data: { object }
	} as any);
}

describe('webhook の堅牢化（監査 H-1 / H-2 / M-1 / M-5）', () => {
	beforeEach(() => vi.clearAllMocks());

	describe('M-1: 処理不能なイベントは 200 を返して再送ループを止める', () => {
		it('metadata が不正な checkout.session.completed は 200 で終了する', async () => {
			// is_organization が無い＝Stripe が再送しても永久に成功しない種類のエラー
			mockEvent('checkout.session.completed', {
				id: 'cs_1',
				customer: 'cus_test_123',
				subscription: 'sub_test_123',
				metadata: { user_id: 'user_123' }
			});
			createSupabaseMock({});

			const res = await POST(webhookRequest());

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.dropped).toBe(true);
		});

		it('一時的なエラー（DB障害など）は従来どおり 500 で再送させる', async () => {
			mockEvent('checkout.session.completed', {
				id: 'cs_1',
				customer: 'cus_test_123',
				subscription: 'sub_test_123',
				metadata: { user_id: 'user_123', is_organization: 'false' }
			});
			vi.mocked(stripe.subscriptions.retrieve).mockRejectedValue(new Error('Stripe API down'));
			createSupabaseMock({});

			await expect(POST(webhookRequest())).rejects.toMatchObject({ status: 500 });
		});
	});

	describe('H-2: 決済が確定するまでプラン権限を与えない', () => {
		it('incomplete の組織アップグレードでは organizations の plan_type を上げない', async () => {
			mockEvent('checkout.session.completed', {
				id: 'cs_1',
				customer: 'cus_test_123',
				subscription: 'sub_test_123',
				metadata: {
					user_id: 'user_123',
					is_organization: 'true',
					is_upgrade: 'true',
					organization_id: 'org_1',
					organization_name: 'テスト組織',
					max_members: '100'
				}
			});
			vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(
				cloverSubscription({ status: 'incomplete' }) as any
			);
			const db = createSupabaseMock({});

			const res = await POST(webhookRequest());

			expect(res.status).toBe(200);
			// 決済未確定なので organizations の plan_type は触らない
			const orgUpdates = db.updateArgs('organizations');
			expect(orgUpdates.some((u: any) => u.plan_type === 'premium')).toBe(false);
			// subscriptions の記録自体は残す（後続イベントで昇格できるように）
			expect(db.upsertArgs('subscriptions').length).toBeGreaterThan(0);
		});

		it('active の組織アップグレードでは従来どおり plan_type を上げる', async () => {
			mockEvent('checkout.session.completed', {
				id: 'cs_1',
				customer: 'cus_test_123',
				subscription: 'sub_test_123',
				metadata: {
					user_id: 'user_123',
					is_organization: 'true',
					is_upgrade: 'true',
					organization_id: 'org_1',
					organization_name: 'テスト組織',
					max_members: '100'
				}
			});
			vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(cloverSubscription() as any);
			vi.mocked(stripe.subscriptions.list).mockResolvedValue({ data: [] } as any);
			const db = createSupabaseMock({
				plan_limits: [{ data: { max_organization_members: 100 }, error: null }]
			});

			const res = await POST(webhookRequest());

			expect(res.status).toBe(200);
			const orgUpdates = db.updateArgs('organizations');
			expect(orgUpdates.some((u: any) => u.plan_type === 'premium')).toBe(true);
		});
	});

	describe('M-5: max_members は metadata ではなく plan_limits を正とする', () => {
		it('metadata の max_members が実際の上限と食い違っていても plan_limits を使う', async () => {
			mockEvent('checkout.session.completed', {
				id: 'cs_1',
				customer: 'cus_test_123',
				subscription: 'sub_test_123',
				metadata: {
					user_id: 'user_123',
					is_organization: 'true',
					is_upgrade: 'true',
					organization_id: 'org_1',
					organization_name: 'テスト組織',
					max_members: '9999' // 古い/改変された値
				}
			});
			vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(cloverSubscription() as any);
			vi.mocked(stripe.subscriptions.list).mockResolvedValue({ data: [] } as any);
			const db = createSupabaseMock({
				plan_limits: [{ data: { max_organization_members: 100 }, error: null }]
			});

			await POST(webhookRequest());

			const orgUpdates = db.updateArgs('organizations');
			expect(orgUpdates.some((u: any) => u.max_members === 100)).toBe(true);
			expect(orgUpdates.some((u: any) => u.max_members === 9999)).toBe(false);
		});
	});

	describe('H-1: 同一 Customer に複数のサブスクリプション行があっても壊れない', () => {
		it('customer.subscription.created は stripe_subscription_id で行を特定する', async () => {
			mockEvent('customer.subscription.created', cloverSubscription());
			// subscriptions への1回目の問い合わせ = stripe_subscription_id での特定
			const db = createSupabaseMock({
				subscriptions: [{ data: { user_id: 'user_123', organization_id: 'org_1' }, error: null }],
				plan_limits: [{ data: { max_organization_members: 100 }, error: null }]
			});

			const res = await POST(webhookRequest());

			expect(res.status).toBe(200);
			// customer 単位ではなく subscription 単位で引いていること
			const firstLookup = db.filtersFor('subscriptions')[0];
			expect(firstLookup).toContainEqual(['stripe_subscription_id', 'sub_test_123']);
		});

		it('stripe_customer_id では引かない（複数行が正常系のため .single() が壊れる）', async () => {
			mockEvent('customer.subscription.created', cloverSubscription());
			const db = createSupabaseMock({
				subscriptions: [{ data: { user_id: 'user_123', organization_id: 'org_1' }, error: null }],
				plan_limits: [{ data: { max_organization_members: 100 }, error: null }]
			});

			const res = await POST(webhookRequest());

			expect(res.status).toBe(200);
			// migration 053 で stripe_customer_id の UNIQUE は意図的に外されている。
			// customer で引くと複数行＝PostgREST の単一行取得がエラーになるため、使ってはいけない。
			const allFilters = db.filtersFor('subscriptions').flat();
			expect(allFilters.some(([col]) => col === 'stripe_customer_id')).toBe(false);
		});
	});
});

describe('M-2 / M-1: 破棄イベントの追跡可能性（dead-letter）', () => {
	beforeEach(() => vi.clearAllMocks());

	it('未処理のイベントは processing として記録してから処理する', async () => {
		mockEvent('customer.subscription.deleted', { id: 'sub_test_123' });
		const db = createSupabaseMock({
			subscriptions: [{ data: null, error: { message: 'Not found' } }]
		});

		const res = await POST(webhookRequest());

		expect(res.status).toBe(200);
		expect(db.calls.some((c) => c.table === 'stripe_events')).toBe(true);
	});

	it('処理不能で破棄したイベントは理由付きで dropped として残る', async () => {
		// is_organization 欠落＝再送しても永久に成功しない
		mockEvent('checkout.session.completed', {
			id: 'cs_1',
			customer: 'cus_test_123',
			subscription: 'sub_test_123',
			metadata: { user_id: 'user_123' }
		});
		const db = createSupabaseMock({});

		const res = await POST(webhookRequest());

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.dropped).toBe(true);

		// ログだけでなく DB にも破棄理由が残る（監視・再処理の手がかりになる）。
		// payload は保存しないが、event_id から stripe.events.retrieve() で再構築できる。
		const dropWrite = db.updateArgs('stripe_events').find((u: any) => u.status === 'dropped');
		expect(dropWrite).toBeDefined();
		expect(dropWrite.failure_reason).toContain('is_organization');
	});

	it('再送で処理し直すべき失敗では記録を残さない（次の配信で再処理できる）', async () => {
		mockEvent('checkout.session.completed', {
			id: 'cs_1',
			customer: 'cus_test_123',
			subscription: 'sub_test_123',
			metadata: { user_id: 'user_123', is_organization: 'false' }
		});
		vi.mocked(stripe.subscriptions.retrieve).mockRejectedValue(new Error('Stripe API down'));
		const db = createSupabaseMock({});

		await expect(POST(webhookRequest())).rejects.toMatchObject({ status: 500 });

		// completed/dropped にはせず、記録そのものを消す
		const eventWrites = db.updateArgs('stripe_events');
		expect(eventWrites.some((u: any) => u.status === 'completed' || u.status === 'dropped')).toBe(
			false
		);
	});
});

/**
 * ¥0 請求（100%割引クーポン等）では Stripe は決済を行わないため
 * `invoice.payment_succeeded` を送らず、代わりに `invoice.paid` を送る。
 *
 * ⚠️ テストモードで実測: 100%割引のサブスクリプションを作成したとき発火したのは
 * `invoice.paid` / `invoice.finalized` / `invoice.created` / `customer.subscription.created` で、
 * `invoice.payment_succeeded` は**発火しなかった**。
 * `current_period_end` を進めるのは handlePaymentSucceeded だけなので、
 * 無償提供のアカウントでは契約期間が初回のまま永久に更新されない。
 */
describe('¥0 請求（invoice.paid）でも契約期間を更新する', () => {
	beforeEach(() => vi.clearAllMocks());

	const invoiceEvent = (type: string) =>
		mockEvent(type, {
			id: 'in_test_1',
			parent: { subscription_details: { subscription: 'sub_test_123' } }
		});

	it('invoice.paid で subscriptions の期間と status を更新する', async () => {
		invoiceEvent('invoice.paid');
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(cloverSubscription() as any);
		// リプレイ防御の現在値取得（既存レコードなし）
		const db = createSupabaseMock({ subscriptions: [{ data: null, error: null }] });

		const res = await POST(webhookRequest());

		expect(res.status).toBe(200);
		expect(db.updateArgs('subscriptions')).toContainEqual(
			expect.objectContaining({
				status: 'active',
				current_period_start: '2022-01-01T00:00:00.000Z',
				current_period_end: '2022-02-01T00:00:00.000Z'
			})
		);
	});

	it('有償請求で両方のイベントが届いても二重反映しない', async () => {
		// 有償の場合は invoice.payment_succeeded と invoice.paid の両方が飛ぶ。
		// event.id が異なるので冪等化では弾けず、リプレイ防御が効く必要がある。
		invoiceEvent('invoice.paid');
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(cloverSubscription() as any);
		const db = createSupabaseMock({
			subscriptions: [
				{
					// 先に invoice.payment_succeeded が反映した後の状態
					data: {
						current_period_end: '2022-02-01T00:00:00.000Z',
						status: 'active',
						cancel_at_period_end: false
					},
					error: null
				}
			]
		});

		const res = await POST(webhookRequest());

		expect(res.status).toBe(200);
		// 同一内容なので DB 更新は省略される
		expect(db.updateArgs('subscriptions')).toHaveLength(0);
	});
});
