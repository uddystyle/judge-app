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
});
