import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Stripe
vi.mock('$lib/server/stripe', () => ({
	stripe: {
		subscriptions: {
			retrieve: vi.fn(),
			update: vi.fn()
		}
	}
}));

// Mock environment variables
vi.mock('$env/static/private', () => ({
	STRIPE_PRICE_BASIC_MONTH: 'price_basic_month',
	STRIPE_PRICE_BASIC_YEAR: 'price_basic_year',
	STRIPE_PRICE_STANDARD_MONTH: 'price_standard_month',
	STRIPE_PRICE_STANDARD_YEAR: 'price_standard_year',
	STRIPE_PRICE_PREMIUM_MONTH: 'price_premium_month',
	STRIPE_PRICE_PREMIUM_YEAR: 'price_premium_year'
}));

// Import after mocks
import { actions } from '../../../routes/organization/[id]/change-plan/+page.server';
import { stripe } from '$lib/server/stripe';

/**
 * Supabaseクエリビルダーのチェーン可能なthenableモック
 */
const createChainMock = (result: any) => {
	const chain: any = {};
	const methods = [
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
	];
	for (const m of methods) {
		chain[m] = vi.fn(() => chain);
	}
	chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
	return chain;
};

/**
 * 書き込み先テーブルとチェーンを記録するadminクライアントモック
 */
const createAdminClientMock = () => {
	const calls: { table: string; chain: any }[] = [];
	const client = {
		from: vi.fn((table: string) => {
			const chain = createChainMock({ data: null, error: null });
			calls.push({ table, chain });
			return chain;
		})
	};
	return { client, calls };
};

const createUserClient = (fromResults: any[]) => {
	const client: any = {
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			})
		},
		from: vi.fn()
	};
	for (const result of fromResults) {
		client.from.mockReturnValueOnce(createChainMock(result));
	}
	return client;
};

const createFormRequest = (fields: Record<string, string>) => {
	const formData = {
		get: (key: string) => fields[key] ?? null
	};
	return { formData: async () => formData } as unknown as Request;
};

describe('change-planアクションのDB書き込みクライアント（SEC-3）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('changePlan: organizations/subscriptionsへの書き込みはsupabaseAdmin経由で行われる', async () => {
		const userClient = createUserClient([
			// organizations（読み取り・認可用）
			{
				data: { id: 'org_1', name: 'Org', plan_type: 'basic', stripe_subscription_id: 'sub_1' },
				error: null
			},
			// organization_members（admin判定）
			{ data: { role: 'admin' }, error: null },
			// subscriptions（読み取り）
			{
				data: {
					stripe_subscription_id: 'sub_1',
					plan_type: 'basic',
					billing_interval: 'month',
					status: 'active'
				},
				error: null
			},
			// plan_limits（読み取り）
			{ data: { max_organization_members: 100 }, error: null }
		]);
		const { client: adminClient, calls: adminCalls } = createAdminClientMock();

		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_1',
			items: {
				data: [{ id: 'si_1', price: { recurring: { interval: 'month' } } }]
			}
		} as any);
		vi.mocked(stripe.subscriptions.update).mockResolvedValue({
			id: 'sub_1',
			status: 'active',
			current_period_start: 1750000000,
			current_period_end: 1752600000
		} as any);

		try {
			await actions.changePlan({
				request: createFormRequest({ planType: 'premium', billingInterval: 'month' }),
				params: { id: 'org_1' },
				locals: { supabase: userClient, supabaseAdmin: adminClient }
			} as any);
			expect.fail('Expected redirect');
		} catch (err: any) {
			expect(err.status).toBe(303);
			expect(err.location).toBe('/pricing?changed=true');
		}

		// 書き込みはadminクライアント経由（RLSに依存しない）
		const orgWrite = adminCalls.find((c) => c.table === 'organizations');
		const subWrite = adminCalls.find((c) => c.table === 'subscriptions');
		expect(orgWrite).toBeDefined();
		expect(orgWrite!.chain.update).toHaveBeenCalledWith(
			expect.objectContaining({ plan_type: 'premium', max_members: 100 })
		);
		expect(subWrite).toBeDefined();
		expect(subWrite!.chain.update).toHaveBeenCalledWith(
			expect.objectContaining({ plan_type: 'premium', billing_interval: 'month' })
		);
	});

	it('cancelSubscription: subscriptionsへの書き込みはsupabaseAdmin経由で行われる', async () => {
		const userClient = createUserClient([
			// organizations（読み取り・認可用）
			{
				data: { id: 'org_1', name: 'Org', plan_type: 'basic', stripe_subscription_id: 'sub_1' },
				error: null
			},
			// organization_members（admin判定）
			{ data: { role: 'admin' }, error: null },
			// subscriptions（読み取り）
			{
				data: {
					stripe_subscription_id: 'sub_1',
					plan_type: 'basic',
					billing_interval: 'month',
					status: 'active'
				},
				error: null
			}
		]);
		const { client: adminClient, calls: adminCalls } = createAdminClientMock();

		vi.mocked(stripe.subscriptions.update).mockResolvedValue({
			id: 'sub_1',
			cancel_at_period_end: true,
			cancel_at: 1752600000
		} as any);

		try {
			await actions.cancelSubscription({
				params: { id: 'org_1' },
				locals: { supabase: userClient, supabaseAdmin: adminClient }
			} as any);
			expect.fail('Expected redirect');
		} catch (err: any) {
			expect(err.status).toBe(303);
			expect(err.location).toBe('/organization/org_1/change-plan?cancelled=true');
		}

		const subWrite = adminCalls.find((c) => c.table === 'subscriptions');
		expect(subWrite).toBeDefined();
		expect(subWrite!.chain.update).toHaveBeenCalledWith(
			expect.objectContaining({ cancel_at_period_end: true })
		);
	});

	it('changePlan: supabaseAdmin未設定の場合はStripe変更前に500で失敗する', async () => {
		const userClient = createUserClient([
			{
				data: { id: 'org_1', name: 'Org', plan_type: 'basic', stripe_subscription_id: 'sub_1' },
				error: null
			},
			{ data: { role: 'admin' }, error: null },
			{
				data: {
					stripe_subscription_id: 'sub_1',
					plan_type: 'basic',
					billing_interval: 'month',
					status: 'active'
				},
				error: null
			}
		]);

		const result: any = await actions.changePlan({
			request: createFormRequest({ planType: 'premium', billingInterval: 'month' }),
			params: { id: 'org_1' },
			locals: { supabase: userClient, supabaseAdmin: undefined }
		} as any);

		expect(result.status).toBe(500);
		// Stripe側の変更は行われない（DB反映できないままStripeだけ変わる事故を防ぐ）
		expect(stripe.subscriptions.update).not.toHaveBeenCalled();
	});

	/**
	 * 請求間隔の変更（月↔年）では `billing_cycle_anchor: 'unchanged'` を渡せない。
	 * Stripe が 400 を返す:
	 *   "Changing plan intervals. There's no way to leave billing cycle unchanged."
	 *
	 * ⚠️ 以前は年額→月額が `proration_behavior: 'none'` + `anchor: 'unchanged'` に落ちており、
	 * UI にトグルがあるのに**必ず 500 で失敗**していた（clover/acacia 両方で再現＝APIバージョンとは無関係）。
	 * 未使用分を顧客に返すため、間隔変更はアップグレードと同じ always_invoice + anchor=now を使う
	 * （テストモード実測: 年額 ¥88,000 の未使用分が ¥-79,200 のクレジットとして返る）。
	 */
	it('changePlan: 年額→月額は always_invoice + anchor=now で呼ぶ（unchanged は Stripe が拒否する）', async () => {
		const userClient = createUserClient([
			{
				data: { id: 'org_1', name: 'Org', plan_type: 'basic', stripe_subscription_id: 'sub_1' },
				error: null
			},
			{ data: { role: 'admin' }, error: null },
			{
				data: {
					stripe_subscription_id: 'sub_1',
					plan_type: 'basic',
					billing_interval: 'year',
					status: 'active'
				},
				error: null
			},
			{ data: { max_organization_members: 10 }, error: null }
		]);
		const { client: adminClient } = createAdminClientMock();

		// 現在の請求間隔は年額
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_1',
			items: { data: [{ id: 'si_1', price: { recurring: { interval: 'year' } } }] }
		} as any);
		vi.mocked(stripe.subscriptions.update).mockResolvedValue({
			id: 'sub_1',
			status: 'active',
			items: {
				data: [{ id: 'si_1', current_period_start: 1640995200, current_period_end: 1643673600 }]
			}
		} as any);

		// 成功時は redirect が投げられる。DB更新まで通ったことをここで担保する
		// （例外を握り潰すと、Stripe 変更後に DB 更新が失敗しても通ってしまう）
		try {
			await actions.changePlan({
				request: createFormRequest({ planType: 'basic', billingInterval: 'month' }),
				params: { id: 'org_1' },
				locals: { supabase: userClient, supabaseAdmin: adminClient }
			} as any);
			expect.fail('Expected redirect');
		} catch (err: any) {
			expect(err.status).toBe(303);
			expect(err.location).toBe('/pricing?changed=true');
		}

		expect(stripe.subscriptions.update).toHaveBeenCalledWith(
			'sub_1',
			expect.objectContaining({
				proration_behavior: 'always_invoice',
				billing_cycle_anchor: 'now'
			})
		);
	});

	it('changePlan: 同一間隔のダウングレードは追加請求なし（none + unchanged）のまま', async () => {
		const userClient = createUserClient([
			{
				data: { id: 'org_1', name: 'Org', plan_type: 'premium', stripe_subscription_id: 'sub_1' },
				error: null
			},
			{ data: { role: 'admin' }, error: null },
			{
				data: {
					stripe_subscription_id: 'sub_1',
					plan_type: 'premium',
					billing_interval: 'month',
					status: 'active'
				},
				error: null
			},
			{ data: { max_organization_members: 10 }, error: null }
		]);
		const { client: adminClient } = createAdminClientMock();

		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_1',
			items: { data: [{ id: 'si_1', price: { recurring: { interval: 'month' } } }] }
		} as any);
		vi.mocked(stripe.subscriptions.update).mockResolvedValue({
			id: 'sub_1',
			status: 'active',
			items: {
				data: [{ id: 'si_1', current_period_start: 1640995200, current_period_end: 1643673600 }]
			}
		} as any);

		// 成功時は redirect が投げられる。DB更新まで通ったことをここで担保する
		// （例外を握り潰すと、Stripe 変更後に DB 更新が失敗しても通ってしまう）
		try {
			await actions.changePlan({
				request: createFormRequest({ planType: 'basic', billingInterval: 'month' }),
				params: { id: 'org_1' },
				locals: { supabase: userClient, supabaseAdmin: adminClient }
			} as any);
			expect.fail('Expected redirect');
		} catch (err: any) {
			expect(err.status).toBe(303);
			expect(err.location).toBe('/pricing?changed=true');
		}

		expect(stripe.subscriptions.update).toHaveBeenCalledWith(
			'sub_1',
			expect.objectContaining({
				proration_behavior: 'none',
				billing_cycle_anchor: 'unchanged'
			})
		);
	});

	/**
	 * pin 中の API バージョン 2025-10-29.clover では subscriptions.update() の戻り値に
	 * トップレベルの current_period_* が無く、items.data[] にのみ存在する。
	 * 旧形状しか読めない実装だと RangeError で 500 になり、Stripe だけ変更されて
	 * DB が追随しない状態になる。
	 */
	it('changePlan: clover形状（期間がitems配下）でも期間をDBへ反映する', async () => {
		const userClient = createUserClient([
			{
				data: { id: 'org_1', name: 'Org', plan_type: 'basic', stripe_subscription_id: 'sub_1' },
				error: null
			},
			{ data: { role: 'admin' }, error: null },
			{
				data: {
					stripe_subscription_id: 'sub_1',
					plan_type: 'basic',
					billing_interval: 'month',
					status: 'active'
				},
				error: null
			},
			{ data: { max_organization_members: 100 }, error: null }
		]);
		const { client: adminClient, calls: adminCalls } = createAdminClientMock();

		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_1',
			items: { data: [{ id: 'si_1', price: { recurring: { interval: 'month' } } }] }
		} as any);
		// clover 形状: トップレベルに current_period_* を置かない
		vi.mocked(stripe.subscriptions.update).mockResolvedValue({
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
		} as any);

		try {
			await actions.changePlan({
				request: createFormRequest({ planType: 'premium', billingInterval: 'month' }),
				params: { id: 'org_1' },
				locals: { supabase: userClient, supabaseAdmin: adminClient }
			} as any);
			expect.fail('Expected redirect');
		} catch (err: any) {
			expect(err.status).toBe(303);
		}

		const subWrite = adminCalls.find((c) => c.table === 'subscriptions');
		expect(subWrite).toBeDefined();
		expect(subWrite!.chain.update).toHaveBeenCalledWith(
			expect.objectContaining({
				current_period_start: '2022-01-01T00:00:00.000Z',
				current_period_end: '2022-02-01T00:00:00.000Z'
			})
		);
	});
});

/**
 * プラン変更で追加請求が発生する経路（proration_behavior: 'always_invoice'）は、
 * 支払いが確定しないまま権限を上げてはいけない。
 *
 * ⚠️ Stripe の `payment_behavior` 既定は `allow_incomplete` で、追加請求が失敗しても
 * `subscriptions.update()` は**成功して past_due を返す**（テストモードで実測確認済み:
 * status=past_due / 請求書は open ¥41,000 未払い）。
 * それを無条件に DB へ反映していたため、未決済のまま上位プランが有効になっていた。
 */
describe('プラン変更時の支払い確定（未決済で権限を上げない）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const upgradeClients = () => {
		const userClient = createUserClient([
			{
				data: { id: 'org_1', name: 'Org', plan_type: 'basic', stripe_subscription_id: 'sub_1' },
				error: null
			},
			{ data: { role: 'admin' }, error: null },
			{
				data: {
					stripe_subscription_id: 'sub_1',
					plan_type: 'basic',
					billing_interval: 'month',
					status: 'active'
				},
				error: null
			},
			{ data: { max_organization_members: 100 }, error: null }
		]);
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_1',
			items: { data: [{ id: 'si_1', price: { recurring: { interval: 'month' } } }] }
		} as any);
		return userClient;
	};

	const runUpgrade = (userClient: any, adminClient: any) =>
		actions.changePlan({
			request: createFormRequest({ planType: 'premium', billingInterval: 'month' }),
			params: { id: 'org_1' },
			locals: { supabase: userClient, supabaseAdmin: adminClient }
		} as any);

	it('追加請求が発生する変更では error_if_incomplete を指定する', async () => {
		const userClient = upgradeClients();
		const { client: adminClient } = createAdminClientMock();
		vi.mocked(stripe.subscriptions.update).mockResolvedValue({
			id: 'sub_1',
			status: 'active',
			items: {
				data: [{ id: 'si_1', current_period_start: 1640995200, current_period_end: 1643673600 }]
			}
		} as any);

		try {
			await runUpgrade(userClient, adminClient);
		} catch {
			/* redirect */
		}

		expect(stripe.subscriptions.update).toHaveBeenCalledWith(
			'sub_1',
			expect.objectContaining({ payment_behavior: 'error_if_incomplete' })
		);
	});

	it('update が past_due を返したら組織のプランを上げない', async () => {
		const userClient = upgradeClients();
		const { client: adminClient, calls: adminCalls } = createAdminClientMock();
		// 追加請求が失敗した場合の実際の戻り値
		vi.mocked(stripe.subscriptions.update).mockResolvedValue({
			id: 'sub_1',
			status: 'past_due',
			items: {
				data: [{ id: 'si_1', current_period_start: 1640995200, current_period_end: 1643673600 }]
			}
		} as any);

		const result: any = await runUpgrade(userClient, adminClient);

		expect(result.status).toBe(500);
		// organizations への書き込み自体が起きない（＝プランは上がらない）
		const orgWrites = adminCalls.filter((c) => c.table === 'organizations');
		expect(orgWrites).toHaveLength(0);
	});

	it('SCA等で incomplete が返った場合も組織のプランを上げない', async () => {
		const userClient = upgradeClients();
		const { client: adminClient, calls: adminCalls } = createAdminClientMock();
		vi.mocked(stripe.subscriptions.update).mockResolvedValue({
			id: 'sub_1',
			status: 'incomplete',
			items: {
				data: [{ id: 'si_1', current_period_start: 1640995200, current_period_end: 1643673600 }]
			}
		} as any);

		const result: any = await runUpgrade(userClient, adminClient);

		expect(result.status).toBe(500);
		// organizations への書き込み自体が起きない（＝プランは上がらない）
		const orgWrites = adminCalls.filter((c) => c.table === 'organizations');
		expect(orgWrites).toHaveLength(0);
	});

	it('追加請求の無いダウングレードは past_due でも従来どおり適用する', async () => {
		// 支払いが滞っている顧客の「格下げ」を止めるのは不利益なので、
		// 請求が発生しない経路（proration_behavior: 'none'）は status で門番しない。
		const userClient = createUserClient([
			{
				data: { id: 'org_1', name: 'Org', plan_type: 'premium', stripe_subscription_id: 'sub_1' },
				error: null
			},
			{ data: { role: 'admin' }, error: null },
			{
				data: {
					stripe_subscription_id: 'sub_1',
					plan_type: 'premium',
					billing_interval: 'month',
					status: 'past_due'
				},
				error: null
			},
			{ data: { max_organization_members: 10 }, error: null }
		]);
		const { client: adminClient, calls: adminCalls } = createAdminClientMock();
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_1',
			items: { data: [{ id: 'si_1', price: { recurring: { interval: 'month' } } }] }
		} as any);
		vi.mocked(stripe.subscriptions.update).mockResolvedValue({
			id: 'sub_1',
			status: 'past_due',
			items: {
				data: [{ id: 'si_1', current_period_start: 1640995200, current_period_end: 1643673600 }]
			}
		} as any);

		try {
			await actions.changePlan({
				request: createFormRequest({ planType: 'basic', billingInterval: 'month' }),
				params: { id: 'org_1' },
				locals: { supabase: userClient, supabaseAdmin: adminClient }
			} as any);
			expect.fail('Expected redirect');
		} catch (err: any) {
			expect(err.status).toBe(303);
		}

		const orgWrite = adminCalls.find((c) => c.table === 'organizations');
		expect(orgWrite!.chain.update).toHaveBeenCalledWith(
			expect.objectContaining({ plan_type: 'basic' })
		);
	});
});
