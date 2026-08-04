import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Webhook 署名検証の実物テスト
 *
 * ⚠️ なぜ別ファイルなのか:
 * `stripe.webhook.test.ts` は `$lib/server/stripe` を丸ごとモックしており、
 * `stripe.webhooks.constructEvent` が**一度も実行されていない**。そのため
 *  - 署名検証そのもの（whsec の扱い・タイムスタンプ許容差・改ざん検知）
 *  - Stripe SDK が実際に受け付けるペイロード形状
 * が回帰対象から漏れていた。
 *
 * このファイルは `$lib/server/stripe` を**モックしない**。実 SDK の
 * `generateTestHeaderStringAsync()` で本物の署名を作り、ハンドラ内の
 * `constructEventAsync` を実際に走らせる。Stripe API への通信は発生しない
 * （署名生成・検証はローカルの HMAC 計算のみ）。
 */

const WEBHOOK_SECRET = 'whsec_test_secret';

// $env/static/private だけモックする（実キーは使わない。sk_test_ 始まりで
// livemode 検証がテスト環境として扱われる）
vi.mock('$env/static/private', () => ({
	STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
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
	PUBLIC_SUPABASE_URL: 'https://example.supabase.co'
}));

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }
}));

// Supabase は叩かせない（署名検証より後ろの処理は既存テストの担当）
vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ from: vi.fn() }))
}));

// 署名検証を通った後のディスパッチ先。ここが呼ばれた＝検証を通過した証跡になる
const { handleCheckoutCompleted } = vi.hoisted(() => ({
	handleCheckoutCompleted: vi.fn(async () => {})
}));
vi.mock('$lib/server/stripeWebhook/checkout', () => ({
	handleCheckoutCompleted,
	handleOrganizationCheckout: vi.fn(async () => {})
}));
vi.mock('$lib/server/stripeWebhook/subscription', () => ({
	handleSubscriptionCreated: vi.fn(async () => {}),
	handleSubscriptionUpdated: vi.fn(async () => {}),
	handleSubscriptionDeleted: vi.fn(async () => {})
}));
vi.mock('$lib/server/stripeWebhook/invoice', () => ({
	handlePaymentSucceeded: vi.fn(async () => {}),
	handlePaymentFailed: vi.fn(async () => {})
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() }
}));

const { POST } = await import('../../../routes/api/stripe/webhook/+server');

/** 署名生成専用の SDK インスタンス（API 通信はしない） */
const signer = new Stripe('sk_test_mock_key', { apiVersion: '2025-10-29.clover' });

/** checkout.session.completed の最小イベント（テストモード） */
const checkoutEvent = (overrides: Record<string, unknown> = {}) => ({
	id: 'evt_test_signature',
	object: 'event',
	api_version: '2025-10-29.clover',
	created: Math.floor(Date.now() / 1000),
	livemode: false,
	type: 'checkout.session.completed',
	data: {
		object: {
			id: 'cs_test_123',
			object: 'checkout.session',
			mode: 'subscription',
			metadata: { user_id: 'user-1', plan_type: 'basic' }
		}
	},
	...overrides
});

/** 本物の署名ヘッダを付けた Request を作る（署名生成も非同期版を使う） */
async function signedRequest(payload: string, opts: { secret?: string; timestamp?: number } = {}) {
	const header = await signer.webhooks.generateTestHeaderStringAsync({
		payload,
		secret: opts.secret ?? WEBHOOK_SECRET,
		...(opts.timestamp !== undefined ? { timestamp: opts.timestamp } : {})
	});

	return {
		headers: { get: (name: string) => (name === 'stripe-signature' ? header : null) },
		text: async () => payload
	} as unknown as RequestEvent['request'];
}

// POST は自ルートの RequestEvent 型を要求するため、テストでは request だけを渡す
const call = (request: RequestEvent['request']) =>
	POST({ request } as unknown as Parameters<typeof POST>[0]);

describe('Stripe webhook の署名検証（constructEventAsync を実際に実行する）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('正しい署名のイベントは検証を通過してディスパッチされる', async () => {
		const payload = JSON.stringify(checkoutEvent());

		const response = await call(await signedRequest(payload));

		expect(response.status).toBe(200);
		expect(handleCheckoutCompleted).toHaveBeenCalledTimes(1);
		// ディスパッチされたのは署名検証を通った本物のイベントの data.object
		expect(handleCheckoutCompleted).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'cs_test_123' })
		);
	});

	it('❗ 署名が別のシークレットで作られていれば 400 で拒否する', async () => {
		const payload = JSON.stringify(checkoutEvent());

		await expect(
			call(await signedRequest(payload, { secret: 'whsec_wrong_secret' }))
		).rejects.toMatchObject({ status: 400 });

		expect(handleCheckoutCompleted).not.toHaveBeenCalled();
	});

	it('❗ 署名後にボディを改ざんすると 400 で拒否する（HMAC が一致しない）', async () => {
		const original = JSON.stringify(checkoutEvent());
		const header = await signer.webhooks.generateTestHeaderStringAsync({
			payload: original,
			secret: WEBHOOK_SECRET
		});
		const tampered = original.replace('cs_test_123', 'cs_test_TAMPERED');

		const request = {
			headers: { get: (n: string) => (n === 'stripe-signature' ? header : null) },
			text: async () => tampered
		} as unknown as RequestEvent['request'];

		await expect(call(request)).rejects.toMatchObject({ status: 400 });
		expect(handleCheckoutCompleted).not.toHaveBeenCalled();
	});

	it('❗ タイムスタンプが許容差を超えて古い署名は 400 で拒否する（リプレイ対策）', async () => {
		const payload = JSON.stringify(checkoutEvent());
		// Stripe の既定許容差は 300 秒
		const oldTimestamp = Math.floor(Date.now() / 1000) - 60 * 60;

		await expect(
			call(await signedRequest(payload, { timestamp: oldTimestamp }))
		).rejects.toMatchObject({ status: 400 });

		expect(handleCheckoutCompleted).not.toHaveBeenCalled();
	});

	it('署名ヘッダが無ければ 400（検証まで到達しない）', async () => {
		const request = {
			headers: { get: () => null },
			text: async () => '{}'
		} as unknown as RequestEvent['request'];

		await expect(call(request)).rejects.toMatchObject({ status: 400 });
		expect(handleCheckoutCompleted).not.toHaveBeenCalled();
	});

	it('❗ テスト鍵の環境に livemode=true のイベントが来たら 2xx で握り潰さない（T14）', async () => {
		const payload = JSON.stringify(checkoutEvent({ livemode: true }));

		// 本物の署名は通るが、livemode 不一致で弾かれることを確認する
		await expect(call(await signedRequest(payload))).rejects.toMatchObject({
			status: expect.any(Number)
		});

		expect(handleCheckoutCompleted).not.toHaveBeenCalled();
	});
});
