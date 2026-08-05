import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * M-6: livemode 判定は制限付きAPIキー（rk_）でも正しく動かなければならない。
 *
 * ⚠️ 以前は `STRIPE_SECRET_KEY.startsWith('sk_live_')` で判定していたため、
 * Stripe 推奨の制限付きキー（`rk_live_`）へ移行した瞬間に
 * 「テスト鍵の環境に本番イベントが届いている」と誤判定し、
 * **本番の webhook が全て 503 になる**状態だった。
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

// 本番の制限付きキーを使っている環境を模す
vi.mock('$env/static/private', () => ({
	STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
	STRIPE_SECRET_KEY: 'rk_live_mock_restricted_key',
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

function webhookRequest() {
	return {
		request: {
			headers: { get: (n: string) => (n === 'stripe-signature' ? 'sig' : null) },
			text: vi.fn().mockResolvedValue('body')
		}
	} as any;
}

describe('M-6: 制限付きAPIキー（rk_live_）での livemode 判定', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSupabaseClient.from.mockReset();
	});

	it('rk_live_ の環境に本番イベントが届いても 503 にしない', async () => {
		mockConstructEvent.mockReturnValue({
			id: 'evt_live_1',
			type: 'customer.subscription.deleted',
			livemode: true,
			data: { object: { id: 'sub_live_1' } }
		} as any);
		// 該当行なし＝ハンドラは正常終了する
		const chain: any = {
			select: vi.fn(() => chain),
			eq: vi.fn(() => chain),
			single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
			maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
		};
		mockSupabaseClient.from.mockReturnValue(chain);

		const res = await POST(webhookRequest());

		expect(res.status).toBe(200);
	});

	it('rk_live_ の環境にテストイベントが届いた場合はスキップする', async () => {
		mockConstructEvent.mockReturnValue({
			id: 'evt_test_1',
			type: 'customer.subscription.deleted',
			livemode: false,
			data: { object: { id: 'sub_test_1' } }
		} as any);

		const res = await POST(webhookRequest());

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.skipped).toBe(true);
		expect(body.reason).toBe('livemode_mismatch');
	});
});
