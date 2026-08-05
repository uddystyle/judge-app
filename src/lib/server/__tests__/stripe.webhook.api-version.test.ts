import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * API バージョン差分の回帰テスト
 *
 * ⚠️ 背景: `current_period_start` / `current_period_end` は Stripe API `2025-03-31.basil` で
 * Subscription のトップレベルから削除され、`items.data[].current_period_*` へ移動した。
 * 本アプリは `2025-10-29.clover` を pin しているため、`subscriptions.retrieve()` の戻り値には
 * **トップレベルの期間フィールドが存在しない**。
 *
 * 過去にこの差分でハンドラが `new Date(undefined * 1000).toISOString()` を実行して
 * `RangeError: Invalid time value` を投げ、決済成立後にサブスクリプションが1件も
 * 保存されない障害が発生した（既存テストのモックが旧 acacia 形状だったため検出できなかった）。
 *
 * ここでは **clover 形状（期間は items にのみ存在）** を正としてハンドラの動作を固定する。
 * 旧形状しか読めない実装に戻したら、このファイルが落ちる。
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

// M-2 の冪等化は専用テスト（stripe.webhook.hardening.test.ts）で検証する。
// ここではディスパッチ・分岐の検証が目的なので、DB を触る冪等化層は差し替える。
vi.mock('$lib/server/stripeWebhook/idempotency', () => ({
	claimStripeEvent: vi.fn(async () => ({ alreadyProcessed: false })),
	completeStripeEvent: vi.fn(async () => {}),
	dropStripeEvent: vi.fn(async () => {}),
	releaseStripeEvent: vi.fn(async () => {}),
	LEASE_MS: 60_000
}));

import { POST } from '../../../routes/api/stripe/webhook/+server';
import { stripe } from '$lib/server/stripe';

// 期間の期待値（clover 形状では items.data[] にのみ存在する）
const PERIOD_START = 1640995200; // 2022-01-01T00:00:00.000Z
const PERIOD_END = 1643673600; // 2022-02-01T00:00:00.000Z
const PERIOD_START_ISO = '2022-01-01T00:00:00.000Z';
const PERIOD_END_ISO = '2022-02-01T00:00:00.000Z';

/**
 * Stripe API 2025-10-29.clover が実際に返す Subscription の形。
 * トップレベルに current_period_* を**置かない**のが本質。
 */
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
					price: { id: 'price_basic_month', recurring: { interval: 'month' } }
				}
			]
		},
		...overrides
	};
}

type TableCall = {
	table: string;
	upsert: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
};

/**
 * PostgREST 風のチェーン可能なモック。
 * `.single()` は singleResults を先頭から順に返す。終端 await は `{ data: null, error: null }`。
 */
function createSupabaseMock(singleResults: Array<{ data: unknown; error: unknown }> = []) {
	const calls: TableCall[] = [];
	const queue = [...singleResults];

	mockSupabaseClient.from.mockImplementation((table: string) => {
		const upsert = vi.fn(() => builder);
		const update = vi.fn(() => builder);
		const builder: any = {
			select: vi.fn(() => builder),
			insert: vi.fn(() => builder),
			upsert,
			update,
			eq: vi.fn(() => builder),
			in: vi.fn(() => builder),
			neq: vi.fn(() => builder),
			single: vi.fn(async () => queue.shift() ?? { data: null, error: null }),
			maybeSingle: vi.fn(async () => queue.shift() ?? { data: null, error: null }),
			then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
		};
		calls.push({ table, upsert, update });
		return builder;
	});

	return {
		calls,
		/** 指定テーブルへの upsert 引数（1件目） */
		upsertArg: (table: string) =>
			calls.find((c) => c.table === table && c.upsert.mock.calls.length > 0)?.upsert.mock
				.calls[0]?.[0],
		/** 指定テーブルへの update 引数（1件目） */
		updateArg: (table: string) =>
			calls.find((c) => c.table === table && c.update.mock.calls.length > 0)?.update.mock
				.calls[0]?.[0]
	};
}

function webhookRequest() {
	return {
		request: {
			headers: { get: (n: string) => (n === 'stripe-signature' ? 'valid_signature' : null) },
			text: vi.fn().mockResolvedValue('webhook_body')
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

describe('Stripe API 2025-10-29.clover 形状の取り扱い', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('checkout.session.completed', () => {
		it('個人課金: items[] の期間を subscriptions に保存する', async () => {
			mockEvent('checkout.session.completed', {
				id: 'cs_test_123',
				customer: 'cus_test_123',
				subscription: 'sub_test_123',
				metadata: { user_id: 'user_123', is_organization: 'false' }
			});
			vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(cloverSubscription() as any);
			const db = createSupabaseMock();

			const response = await POST(webhookRequest());

			expect(response.status).toBe(200);
			expect(db.upsertArg('subscriptions')).toMatchObject({
				user_id: 'user_123',
				stripe_subscription_id: 'sub_test_123',
				plan_type: 'basic',
				current_period_start: PERIOD_START_ISO,
				current_period_end: PERIOD_END_ISO
			});
		});

		it('組織新規: items[] の期間を subscriptions に保存する', async () => {
			mockEvent('checkout.session.completed', {
				id: 'cs_test_123',
				customer: 'cus_test_123',
				subscription: 'sub_test_123',
				metadata: {
					user_id: 'user_123',
					is_organization: 'true',
					organization_name: 'テスト組織',
					max_members: '10'
				}
			});
			vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(cloverSubscription() as any);
			// 1) plan_limits（M-5 で上限の出所になった） 2) organizations.upsert().select().single()
			const db = createSupabaseMock([
				{ data: { max_organization_members: 10 }, error: null },
				{ data: { id: 'org_1' }, error: null }
			]);

			const response = await POST(webhookRequest());

			expect(response.status).toBe(200);
			expect(db.upsertArg('subscriptions')).toMatchObject({
				organization_id: 'org_1',
				current_period_start: PERIOD_START_ISO,
				current_period_end: PERIOD_END_ISO
			});
		});

		it('組織アップグレード: items[] の期間を subscriptions に保存する', async () => {
			mockEvent('checkout.session.completed', {
				id: 'cs_test_123',
				customer: 'cus_test_123',
				subscription: 'sub_test_123',
				metadata: {
					user_id: 'user_123',
					is_organization: 'true',
					is_upgrade: 'true',
					organization_id: 'org_1',
					organization_name: 'テスト組織',
					max_members: '10'
				}
			});
			vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(cloverSubscription() as any);
			vi.mocked(stripe.subscriptions.list).mockResolvedValue({ data: [] } as any);
			// plan_limits（M-5 で上限の出所になった）
			const db = createSupabaseMock([{ data: { max_organization_members: 10 }, error: null }]);

			const response = await POST(webhookRequest());

			expect(response.status).toBe(200);
			expect(db.upsertArg('subscriptions')).toMatchObject({
				organization_id: 'org_1',
				current_period_start: PERIOD_START_ISO,
				current_period_end: PERIOD_END_ISO
			});
		});
	});

	describe('invoice', () => {
		it('payment_succeeded: items[] の期間で subscriptions を更新する', async () => {
			mockEvent('invoice.payment_succeeded', {
				id: 'in_test_123',
				parent: { subscription_details: { subscription: 'sub_test_123' } }
			});
			vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(cloverSubscription() as any);
			// リプレイ防御の現在値取得（既存レコードなし）
			const db = createSupabaseMock([{ data: null, error: null }]);

			const response = await POST(webhookRequest());

			expect(response.status).toBe(200);
			expect(db.updateArg('subscriptions')).toMatchObject({
				status: 'active',
				current_period_start: PERIOD_START_ISO,
				current_period_end: PERIOD_END_ISO
			});
		});

		it('payment_failed: 期間の読み取りに失敗せず past_due へ更新する', async () => {
			mockEvent('invoice.payment_failed', {
				id: 'in_test_123',
				parent: { subscription_details: { subscription: 'sub_test_123' } }
			});
			vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(
				cloverSubscription({ status: 'past_due' }) as any
			);
			const db = createSupabaseMock([{ data: null, error: null }]);

			const response = await POST(webhookRequest());

			expect(response.status).toBe(200);
			expect(db.updateArg('subscriptions')).toMatchObject({ status: 'past_due' });
		});
	});

	describe('期間が取得できない場合', () => {
		it('items にも期間が無ければ 500 を返し DB を書き換えない', async () => {
			mockEvent('checkout.session.completed', {
				id: 'cs_test_123',
				customer: 'cus_test_123',
				subscription: 'sub_test_123',
				metadata: { user_id: 'user_123', is_organization: 'false' }
			});
			vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
				id: 'sub_test_123',
				customer: 'cus_test_123',
				status: 'active',
				cancel_at_period_end: false,
				items: {
					data: [
						{ id: 'si_1', price: { id: 'price_basic_month', recurring: { interval: 'month' } } }
					]
				}
			} as any);
			const db = createSupabaseMock();

			// RangeError の巻き添えではなく、期間が取れないことを明示したエラーであること
			await expect(POST(webhookRequest())).rejects.toMatchObject({
				status: 500,
				body: { message: expect.stringContaining('current_period') }
			});
			expect(db.upsertArg('subscriptions')).toBeUndefined();
		});
	});
});
