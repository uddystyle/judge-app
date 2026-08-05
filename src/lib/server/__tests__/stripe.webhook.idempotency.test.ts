import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * M-2 の冪等化の回帰テスト（レビュー指摘で設計を作り直した箇所）。
 *
 * ⚠️ 旧実装（migration 1030 時点）は本処理の前に INSERT し、その瞬間から
 * 同じ event.id を「処理済み」と判定していた。失敗時は catch で行を消す作りだったため、
 * **catch を通らない終了**（Vercel の maxDuration=10s 超過・プロセス強制終了・デプロイ）では
 * 記録だけが残り、Stripe の再送が「処理済み」と判定されて
 * **そのイベントが二度と処理されない**（課金イベントの永久消失）。
 *
 * 現在は processing / completed / dropped の状態とリース期限を持ち、
 * 永久スキップするのは completed と dropped だけ。processing はリース切れで再取得できる。
 */

const { mockSupabaseClient } = vi.hoisted(() => ({
	mockSupabaseClient: { from: vi.fn() }
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockSupabaseClient) }));
vi.mock('$env/static/private', () => ({
	STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
	STRIPE_SECRET_KEY: 'sk_test_mock_key',
	SUPABASE_SERVICE_ROLE_KEY: 'test_service_role_key'
}));
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

import {
	claimStripeEvent,
	completeStripeEvent,
	dropStripeEvent,
	releaseStripeEvent,
	LEASE_MS
} from '$lib/server/stripeWebhook/idempotency';

const UNIQUE_VIOLATION = {
	code: '23505',
	message: 'duplicate key value violates unique constraint'
};

/**
 * stripe_events だけを相手にする PostgREST 風モック。
 * insert / select / update / delete の結果を個別に差し替えられる。
 */
function createEventsMock(opts: {
	insertError?: unknown;
	existingRow?: { status: string; claimed_at: string } | null;
	/** リース奪取 UPDATE が返す行数（0 なら他プロセスに先を越された） */
	reclaimedRows?: Array<unknown>;
	updateError?: unknown;
	deleteError?: unknown;
}) {
	const calls: Array<{ op: string; payload?: unknown; filters: Array<[string, unknown]> }> = [];

	mockSupabaseClient.from.mockImplementation((table: string) => {
		if (table !== 'stripe_events') throw new Error(`unexpected table: ${table}`);
		const filters: Array<[string, unknown]> = [];
		let op = '';
		let payload: unknown;
		const builder: any = {
			insert: vi.fn((v: unknown) => {
				op = 'insert';
				payload = v;
				calls.push({ op, payload, filters });
				return {
					then: (r: any) => Promise.resolve({ data: null, error: opts.insertError ?? null }).then(r)
				};
			}),
			select: vi.fn(() => builder),
			update: vi.fn((v: unknown) => {
				op = 'update';
				payload = v;
				calls.push({ op, payload, filters });
				return builder;
			}),
			delete: vi.fn(() => {
				op = 'delete';
				calls.push({ op, filters });
				return builder;
			}),
			eq: vi.fn((c: string, v: unknown) => {
				filters.push([c, v]);
				return builder;
			}),
			lt: vi.fn((c: string, v: unknown) => {
				filters.push([c, v]);
				return builder;
			}),
			maybeSingle: vi.fn(async () => ({ data: opts.existingRow ?? null, error: null })),
			then: (r: any) => {
				if (op === 'update') {
					return Promise.resolve({
						data: opts.reclaimedRows ?? [],
						error: opts.updateError ?? null
					}).then(r);
				}
				if (op === 'delete') {
					return Promise.resolve({ data: null, error: opts.deleteError ?? null }).then(r);
				}
				return Promise.resolve({ data: null, error: null }).then(r);
			}
		};
		return builder;
	});

	return { calls };
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe('Webhook 冪等化の状態遷移', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSupabaseClient.from.mockReset();
	});

	it('未処理のイベントは processing として記録し、処理権を得る', async () => {
		const m = createEventsMock({});

		const claim = await claimStripeEvent('evt_1', 'checkout.session.completed');

		expect(claim.alreadyProcessed).toBe(false);
		const insert = m.calls.find((c) => c.op === 'insert');
		expect(insert?.payload).toMatchObject({ event_id: 'evt_1', status: 'processing' });
	});

	it('completed 済みのイベントはスキップする', async () => {
		createEventsMock({
			insertError: UNIQUE_VIOLATION,
			existingRow: { status: 'completed', claimed_at: iso(1000) }
		});

		const claim = await claimStripeEvent('evt_1', 'checkout.session.completed');

		expect(claim.alreadyProcessed).toBe(true);
	});

	it('dropped 済み（破棄確定）のイベントもスキップする', async () => {
		createEventsMock({
			insertError: UNIQUE_VIOLATION,
			existingRow: { status: 'dropped', claimed_at: iso(1000) }
		});

		const claim = await claimStripeEvent('evt_1', 'checkout.session.completed');

		expect(claim.alreadyProcessed).toBe(true);
	});

	it('処理中（リース有効）の同時配送は片方だけが処理する', async () => {
		createEventsMock({
			insertError: UNIQUE_VIOLATION,
			existingRow: { status: 'processing', claimed_at: iso(1000) } // 1秒前＝処理中
		});

		const claim = await claimStripeEvent('evt_1', 'checkout.session.completed');

		expect(claim.alreadyProcessed).toBe(true);
	});

	it('processing のままリースが切れた行は再取得できる（永久消失させない）', async () => {
		// catch を通らず終了したケース。リース切れなら次の再送で処理し直せなければならない。
		const m = createEventsMock({
			insertError: UNIQUE_VIOLATION,
			existingRow: { status: 'processing', claimed_at: iso(LEASE_MS + 60_000) },
			reclaimedRows: [{ event_id: 'evt_1' }]
		});

		const claim = await claimStripeEvent('evt_1', 'checkout.session.completed');

		expect(claim.alreadyProcessed).toBe(false);
		// リース奪取は「status=processing かつ claimed_at が古い」行だけを条件付き更新する
		const update = m.calls.find((c) => c.op === 'update');
		expect(update?.filters).toContainEqual(['status', 'processing']);
	});

	it('リース奪取に他プロセスが先着した場合は処理しない', async () => {
		createEventsMock({
			insertError: UNIQUE_VIOLATION,
			existingRow: { status: 'processing', claimed_at: iso(LEASE_MS + 60_000) },
			reclaimedRows: [] // 条件付き更新が0行＝他が先に取った
		});

		const claim = await claimStripeEvent('evt_1', 'checkout.session.completed');

		expect(claim.alreadyProcessed).toBe(true);
	});

	it('正常終了で completed に更新する', async () => {
		const m = createEventsMock({});

		await completeStripeEvent('evt_1');

		const update = m.calls.find((c) => c.op === 'update');
		expect(update?.payload).toMatchObject({ status: 'completed' });
		expect(update?.filters).toContainEqual(['event_id', 'evt_1']);
	});

	it('破棄時は理由を残して dropped にする（dead-letter レコード）', async () => {
		const m = createEventsMock({});

		await dropStripeEvent('evt_1', 'is_organizationは"true"または"false"である必要があります');

		const update = m.calls.find((c) => c.op === 'update');
		expect(update?.payload).toMatchObject({
			status: 'dropped',
			failure_reason: expect.stringContaining('is_organization')
		});
	});

	it('再送で処理し直す必要がある失敗では記録を削除する', async () => {
		const m = createEventsMock({});

		await releaseStripeEvent('evt_1');

		const del = m.calls.find((c) => c.op === 'delete');
		expect(del).toBeDefined();
		expect(del?.filters).toContainEqual(['event_id', 'evt_1']);
	});

	it('記録の削除に失敗しても例外を投げない（リース切れで回収されるため）', async () => {
		createEventsMock({ deleteError: { code: 'XX000', message: 'connection lost' } });

		// 削除できなくてもリース期限で再取得できるので、ここで落として500を上書きしない
		await expect(releaseStripeEvent('evt_1')).resolves.toBeUndefined();
	});

	it('テーブル未作成なら冪等化なしで処理を続行する', async () => {
		createEventsMock({ insertError: { code: '42P01', message: 'relation does not exist' } });

		const claim = await claimStripeEvent('evt_1', 'checkout.session.completed');

		expect(claim.alreadyProcessed).toBe(false);
	});

	it('その他のDBエラーは再送させる', async () => {
		createEventsMock({ insertError: { code: 'XX000', message: 'connection lost' } });

		await expect(claimStripeEvent('evt_1', 'checkout.session.completed')).rejects.toThrow(
			/イベント記録エラー/
		);
	});
});
