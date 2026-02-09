import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Use vi.hoisted to create mocks that can be referenced in vi.mock
const { mockSupabaseClient } = vi.hoisted(() => {
	return {
		mockSupabaseClient: {
			from: vi.fn()
		}
	};
});

// Mock Stripe
vi.mock('$lib/server/stripe', () => ({
	stripe: {
		webhooks: {
			constructEvent: vi.fn()
		},
		subscriptions: {
			retrieve: vi.fn()
		}
	}
}));

// Mock Supabase createClient
vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => mockSupabaseClient)
}));

// Mock environment variables
vi.mock('$env/static/private', () => ({
	STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
	SUPABASE_SERVICE_ROLE_KEY: 'test_service_role_key',
	STRIPE_PRICE_BASIC_MONTH: 'price_basic_month',
	STRIPE_PRICE_BASIC_YEAR: 'price_basic_year',
	STRIPE_PRICE_STANDARD_MONTH: 'price_standard_month',
	STRIPE_PRICE_STANDARD_YEAR: 'price_standard_year',
	STRIPE_PRICE_PREMIUM_MONTH: 'price_premium_month',
	STRIPE_PRICE_PREMIUM_YEAR: 'price_premium_year'
}));

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'https://test.supabase.co'
}));

// Import after mocks
import { POST } from '../../../routes/api/stripe/webhook/+server';
import { stripe } from '$lib/server/stripe';

describe('Webhook署名検証（P0-1）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const createMockRequest = (signature: string | null, body: string = '{}') => {
		return {
			headers: {
				get: vi.fn((name: string) => {
					if (name === 'stripe-signature') return signature;
					return null;
				})
			},
			text: vi.fn().mockResolvedValue(body)
		} as unknown as Request;
	};

	it('stripe-signatureヘッダがない場合は400を返す', async () => {
		const request = createMockRequest(null);
		const event = { request } as RequestEvent;

		try {
			await POST(event);
			expect.fail('Expected POST to throw an error');
		} catch (err: any) {
			// SvelteKit error() throws an HttpError-like object with status and body
			expect(err.status).toBe(400);
			expect(err.body?.message).toContain('Stripe署名がありません');
		}
	});

	it('stripe.webhooks.constructEventが例外をスローする場合は400を返す', async () => {
		const request = createMockRequest('invalid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		vi.mocked(stripe.webhooks.constructEvent).mockImplementation(() => {
			throw new Error('Invalid signature');
		});

		try {
			await POST(event);
			expect.fail('Expected POST to throw an error');
		} catch (err: any) {
			expect(err.status).toBe(400);
			expect(err.body?.message).toContain('Webhook署名検証エラー');
		}
	});

	it('署名が正当な場合はイベント処理へ進む（200を返す）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock constructEvent to return an unhandled event type (won't trigger any handler)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.created', // Unhandled event type
			data: {
				object: {
					id: 'cus_test_123'
				}
			}
		} as any);

		const response = await POST(event);

		expect(response.status).toBe(200);
		expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
			'webhook_body',
			'valid_signature',
			'whsec_test_secret'
		);
	});
});

describe('Webhookエラー分類（P0-2）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const createMockRequest = (signature: string, body: string = '{}') => {
		return {
			headers: {
				get: vi.fn((name: string) => {
					if (name === 'stripe-signature') return signature;
					return null;
				})
			},
			text: vi.fn().mockResolvedValue(body)
		} as unknown as Request;
	};

	it('NonRetryableErrorが発生した場合は400を返す', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock constructEvent to return subscription.created event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.created',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active'
				}
			}
		} as any);

		// Mock Supabase to return error (subscription not found)
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116', message: 'Not found' }
		});

		mockSupabaseClient.from.mockReturnValue({
			select: mockSelect,
			eq: mockEq,
			single: mockSingle
		} as any);

		try {
			await POST(event);
			expect.fail('Expected POST to throw an error');
		} catch (err: any) {
			expect(err.status).toBe(400);
			expect(err.body?.message).toContain('リトライ不要なエラー');
		}
	});

	it('RetryableErrorが発生した場合は500を返す', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock constructEvent to return subscription.updated event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active',
					current_period_start: 1640995200, // 2022-01-01 00:00:00 UTC (timestamp in seconds)
					current_period_end: 1643673600, // 2022-02-01 00:00:00 UTC
					cancel_at_period_end: false,
					items: {
						data: [
							{
								price: {
									id: 'price_basic_month',
									recurring: {
										interval: 'month'
									}
								}
							}
						]
					}
				}
			}
		} as any);

		// Mock Supabase to simulate database error on update
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: { organization_id: 'org_123' },
			error: null
		});
		const mockUpdate = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({
			data: null,
			error: { message: 'Database connection error' }
		});

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect,
				eq: mockEq1,
				single: mockSingle
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate,
				eq: mockEq2
			} as any);

		try {
			await POST(event);
			expect.fail('Expected POST to throw an error');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('リトライ可能なエラー');
		}
	});

	it('未分類の例外が発生した場合は500を返す', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock constructEvent to return subscription.created event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.created',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active'
				}
			}
		} as any);

		// Mock Supabase to throw unexpected error
		mockSupabaseClient.from.mockImplementation(() => {
			throw new Error('Unexpected error');
		});

		try {
			await POST(event);
			expect.fail('Expected POST to throw an error');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('イベント処理エラー');
		}
	});
});

describe('checkout.session.completed分岐（P0-3）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const createMockRequest = (signature: string, body: string = '{}') => {
		return {
			headers: {
				get: vi.fn((name: string) => {
					if (name === 'stripe-signature') return signature;
					return null;
				})
			},
			text: vi.fn().mockResolvedValue(body)
		} as unknown as Request;
	};

	it('個人課金の場合はsubscriptionsテーブルにupsertする', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock checkout.session.completed event (personal)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'false'
					}
				}
			}
		} as any);

		// Mock stripe.subscriptions.retrieve
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_test_123',
			customer: 'cus_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1643673600,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_basic_month',
							recurring: {
								interval: 'month'
							}
						}
					}
				]
			}
		} as any);

		// Mock Supabase upsert
		const mockUpsert = vi.fn().mockResolvedValue({ data: null, error: null });
		mockSupabaseClient.from.mockReturnValue({
			upsert: mockUpsert
		} as any);

		const response = await POST(event);

		expect(response.status).toBe(200);
		expect(mockUpsert).toHaveBeenCalledWith(
			{
				user_id: 'user_123',
				stripe_customer_id: 'cus_test_123',
				stripe_subscription_id: 'sub_test_123',
				plan_type: 'basic',
				billing_interval: 'month',
				status: 'active',
				current_period_start: expect.any(String),
				current_period_end: expect.any(String),
				cancel_at_period_end: false
			},
			{ onConflict: 'user_id' }
		);
	});

	it('組織新規の場合はorganizationsとsubscriptionsを作成する', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock checkout.session.completed event (organization new)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123',
						organization_name: 'Test Org',
						max_members: '30',
						is_organization: 'true',
						is_upgrade: 'false'
					}
				}
			}
		} as any);

		// Mock stripe.subscriptions.retrieve
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_test_123',
			customer: 'cus_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1643673600,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_standard_month',
							recurring: {
								interval: 'month'
							}
						}
					}
				]
			}
		} as any);

		// Mock Supabase operations
		const mockUpsert1 = vi.fn().mockReturnThis();
		const mockSelect = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: { id: 'org_new_123' },
			error: null
		});
		const mockUpsert2 = vi.fn().mockResolvedValue({ data: null, error: null });
		const mockUpsert3 = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				// organizations upsert
				upsert: mockUpsert1
			} as any)
			.mockReturnValueOnce({
				// organization_members upsert
				upsert: mockUpsert2
			} as any)
			.mockReturnValueOnce({
				// subscriptions upsert
				upsert: mockUpsert3
			} as any);

		mockUpsert1.mockReturnValue({
			select: mockSelect
		} as any);

		mockSelect.mockReturnValue({
			single: mockSingle
		} as any);

		const response = await POST(event);

		expect(response.status).toBe(200);
		// Verify subscriptions upsert (3rd call)
		expect(mockUpsert3).toHaveBeenCalledWith(
			expect.objectContaining({
				user_id: 'user_123',
				organization_id: 'org_new_123',
				stripe_subscription_id: 'sub_test_123',
				plan_type: 'standard'
			}),
			{ onConflict: 'stripe_subscription_id', ignoreDuplicates: false }
		);
	});

	it('組織アップグレードの場合は旧subscriptionをクリアして新subscriptionを作成する', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock checkout.session.completed event (organization upgrade)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_new_123',
					metadata: {
						user_id: 'user_123',
						organization_id: 'org_existing_123',
						organization_name: 'Test Org',
						max_members: '100',
						is_organization: 'true',
						is_upgrade: 'true'
					}
				}
			}
		} as any);

		// Mock stripe.subscriptions.retrieve
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_new_123',
			customer: 'cus_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1643673600,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_premium_month',
							recurring: {
								interval: 'month'
							}
						}
					}
				]
			}
		} as any);

		// Mock Supabase operations
		const mockUpdate1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockIn = vi.fn().mockReturnThis();
		const mockNeq = vi.fn().mockResolvedValue({ data: null, error: null });

		const mockUpdate2 = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });

		const mockUpsert = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				// Clear old subscriptions: update().eq().in().neq()
				update: mockUpdate1
			} as any)
			.mockReturnValueOnce({
				// Update organization: update().eq()
				update: mockUpdate2
			} as any)
			.mockReturnValueOnce({
				// Insert new subscription: upsert()
				upsert: mockUpsert
			} as any);

		mockUpdate1.mockReturnValue({
			eq: mockEq1
		} as any);

		mockEq1.mockReturnValue({
			in: mockIn
		} as any);

		mockIn.mockReturnValue({
			neq: mockNeq
		} as any);

		mockUpdate2.mockReturnValue({
			eq: mockEq2
		} as any);

		const response = await POST(event);

		expect(response.status).toBe(200);

		// Verify old subscriptions were cleared
		expect(mockUpdate1).toHaveBeenCalledWith({
			organization_id: null,
			status: 'canceled'
		});

		// Verify organization was updated
		expect(mockUpdate2).toHaveBeenCalledWith({
			plan_type: 'premium',
			max_members: 100,
			stripe_subscription_id: 'sub_new_123',
			stripe_customer_id: 'cus_test_123'
		});

		// Verify new subscription was created
		expect(mockUpsert).toHaveBeenCalledWith(
			expect.objectContaining({
				organization_id: 'org_existing_123',
				stripe_subscription_id: 'sub_new_123',
				plan_type: 'premium'
			}),
			{ onConflict: 'stripe_subscription_id', ignoreDuplicates: false }
		);
	});
});

describe('Webhookべき等性（P0-4）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const createMockRequest = (signature: string, body: string = '{}') => {
		return {
			headers: {
				get: vi.fn((name: string) => {
					if (name === 'stripe-signature') return signature;
					return null;
				})
			},
			text: vi.fn().mockResolvedValue(body)
		} as unknown as Request;
	};

	it('同一イベントを2回処理しても安全に再実行できる（個人課金）', async () => {
		const createEvent = () => {
			const request = createMockRequest('valid_signature', 'webhook_body');
			return { request } as RequestEvent;
		};

		// Mock checkout.session.completed event (personal)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_idempotent_123', // Same event ID
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'false'
					}
				}
			}
		} as any);

		// Mock stripe.subscriptions.retrieve
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_test_123',
			customer: 'cus_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1643673600,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_basic_month',
							recurring: {
								interval: 'month'
							}
						}
					}
				]
			}
		} as any);

		// Mock Supabase upsert
		const mockUpsert = vi.fn().mockResolvedValue({ data: null, error: null });
		mockSupabaseClient.from.mockReturnValue({
			upsert: mockUpsert
		} as any);

		// First execution
		const response1 = await POST(createEvent());
		expect(response1.status).toBe(200);

		// Second execution (simulating webhook retry with same event)
		const response2 = await POST(createEvent());
		expect(response2.status).toBe(200);

		// Verify upsert was called twice with same parameters
		expect(mockUpsert).toHaveBeenCalledTimes(2);
		expect(mockUpsert).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				user_id: 'user_123',
				stripe_subscription_id: 'sub_test_123'
			}),
			{ onConflict: 'user_id' }
		);
		expect(mockUpsert).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				user_id: 'user_123',
				stripe_subscription_id: 'sub_test_123'
			}),
			{ onConflict: 'user_id' }
		);
	});

	it('組織作成イベントを2回処理しても重複作成されない', async () => {
		const createEvent = () => {
			const request = createMockRequest('valid_signature', 'webhook_body');
			return { request } as RequestEvent;
		};

		// Mock checkout.session.completed event (organization new)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_org_idempotent_123', // Same event ID
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_org_test_123',
					customer: 'cus_org_test_123',
					subscription: 'sub_org_test_123',
					metadata: {
						user_id: 'user_123',
						organization_name: 'Test Org',
						max_members: '30',
						is_organization: 'true',
						is_upgrade: 'false'
					}
				}
			}
		} as any);

		// Mock stripe.subscriptions.retrieve
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_org_test_123',
			customer: 'cus_org_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1643673600,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_standard_month',
							recurring: {
								interval: 'month'
							}
						}
					}
				]
			}
		} as any);

		// Mock Supabase operations (need to handle 6 from() calls total for 2 executions)
		const mockUpsert1 = vi.fn().mockReturnThis();
		const mockSelect = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: { id: 'org_same_123' }, // Same organization ID
			error: null
		});
		const mockUpsert2 = vi.fn().mockResolvedValue({ data: null, error: null });
		const mockUpsert3 = vi.fn().mockResolvedValue({ data: null, error: null });

		// First execution (3 from() calls)
		mockSupabaseClient.from
			.mockReturnValueOnce({
				upsert: mockUpsert1
			} as any)
			.mockReturnValueOnce({
				upsert: mockUpsert2
			} as any)
			.mockReturnValueOnce({
				upsert: mockUpsert3
			} as any)
			// Second execution (3 from() calls)
			.mockReturnValueOnce({
				upsert: mockUpsert1
			} as any)
			.mockReturnValueOnce({
				upsert: mockUpsert2
			} as any)
			.mockReturnValueOnce({
				upsert: mockUpsert3
			} as any);

		mockUpsert1.mockReturnValue({
			select: mockSelect
		} as any);

		mockSelect.mockReturnValue({
			single: mockSingle
		} as any);

		// First execution
		const response1 = await POST(createEvent());
		expect(response1.status).toBe(200);

		// Second execution (webhook retry)
		const response2 = await POST(createEvent());
		expect(response2.status).toBe(200);

		// Verify upsert was called twice for each table with correct onConflict
		// 1. organizations upsert
		expect(mockUpsert1).toHaveBeenCalledTimes(2);
		expect(mockUpsert1).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				name: 'Test Org',
				plan_type: 'standard',
				max_members: 30,
				stripe_customer_id: 'cus_org_test_123',
				stripe_subscription_id: 'sub_org_test_123'
			}),
			{
				onConflict: 'stripe_subscription_id',
				ignoreDuplicates: false
			}
		);
		expect(mockUpsert1).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				name: 'Test Org',
				plan_type: 'standard',
				max_members: 30,
				stripe_customer_id: 'cus_org_test_123',
				stripe_subscription_id: 'sub_org_test_123'
			}),
			{
				onConflict: 'stripe_subscription_id',
				ignoreDuplicates: false
			}
		);

		// 2. organization_members upsert
		expect(mockUpsert2).toHaveBeenCalledTimes(2);
		expect(mockUpsert2).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				organization_id: 'org_same_123',
				user_id: 'user_123',
				role: 'admin'
			}),
			{
				onConflict: 'organization_id,user_id',
				ignoreDuplicates: false
			}
		);
		expect(mockUpsert2).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				organization_id: 'org_same_123',
				user_id: 'user_123',
				role: 'admin'
			}),
			{
				onConflict: 'organization_id,user_id',
				ignoreDuplicates: false
			}
		);

		// 3. subscriptions upsert
		expect(mockUpsert3).toHaveBeenCalledTimes(2);
		expect(mockUpsert3).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				user_id: 'user_123',
				organization_id: 'org_same_123',
				stripe_subscription_id: 'sub_org_test_123'
			}),
			{
				onConflict: 'stripe_subscription_id',
				ignoreDuplicates: false
			}
		);
		expect(mockUpsert3).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				user_id: 'user_123',
				organization_id: 'org_same_123',
				stripe_subscription_id: 'sub_org_test_123'
			}),
			{
				onConflict: 'stripe_subscription_id',
				ignoreDuplicates: false
			}
		);

		// Verify both executions returned same organization ID (via upsert onConflict behavior)
		expect(mockSingle).toHaveBeenCalledTimes(2);
	});
});

describe('請求イベントの状態遷移（P1-2, P1-3）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const createMockRequest = (signature: string, body: string = '{}') => {
		return {
			headers: {
				get: vi.fn((name: string) => {
					if (name === 'stripe-signature') return signature;
					return null;
				})
			},
			text: vi.fn().mockResolvedValue(body)
		} as unknown as Request;
	};

	it('invoice.payment_succeededでsubscriptions.status=activeかつ期間更新', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock invoice.payment_succeeded event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'invoice.payment_succeeded',
			data: {
				object: {
					id: 'in_test_123',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		// Mock stripe.subscriptions.retrieve
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_test_123',
			current_period_start: 1640995200, // 2022-01-01 00:00:00 UTC
			current_period_end: 1672531200 // 2023-01-01 00:00:00 UTC
		} as any);

		// Mock Supabase update
		const mockUpdate = vi.fn().mockReturnThis();
		const mockEq = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from.mockReturnValue({
			update: mockUpdate,
			eq: mockEq
		} as any);

		mockUpdate.mockReturnValue({
			eq: mockEq
		} as any);

		const response = await POST(event);

		expect(response.status).toBe(200);
		expect(mockUpdate).toHaveBeenCalledWith({
			status: 'active',
			current_period_start: '2022-01-01T00:00:00.000Z',
			current_period_end: '2023-01-01T00:00:00.000Z'
		});
		expect(mockEq).toHaveBeenCalledWith('stripe_subscription_id', 'sub_test_123');
	});

	it('invoice.payment_failedでsubscriptions.status=past_due', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock invoice.payment_failed event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'invoice.payment_failed',
			data: {
				object: {
					id: 'in_test_123',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		// Mock Supabase update
		const mockUpdate = vi.fn().mockReturnThis();
		const mockEq = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from.mockReturnValue({
			update: mockUpdate,
			eq: mockEq
		} as any);

		mockUpdate.mockReturnValue({
			eq: mockEq
		} as any);

		const response = await POST(event);

		expect(response.status).toBe(200);
		expect(mockUpdate).toHaveBeenCalledWith({
			status: 'past_due'
		});
		expect(mockEq).toHaveBeenCalledWith('stripe_subscription_id', 'sub_test_123');
	});
});

describe('customer.subscription.deleted分岐（P1-4）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const createMockRequest = (signature: string, body: string = '{}') => {
		return {
			headers: {
				get: vi.fn((name: string) => {
					if (name === 'stripe-signature') return signature;
					return null;
				})
			},
			text: vi.fn().mockResolvedValue(body)
		} as unknown as Request;
	};

	it('削除対象が現行subscriptionのときのみ組織をfreeへ降格', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock customer.subscription.deleted event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.deleted',
			data: {
				object: {
					id: 'sub_current_123'
				}
			}
		} as any);

		// Mock Supabase operations
		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: { organization_id: 'org_123' },
			error: null
		});

		const mockUpdate1 = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });

		const mockSelect2 = vi.fn().mockReturnThis();
		const mockEq3 = vi.fn().mockReturnThis();
		const mockSingle2 = vi.fn().mockResolvedValue({
			// Current subscription matches deleted subscription
			data: { stripe_subscription_id: 'sub_current_123' },
			error: null
		});

		const mockSelect3 = vi.fn().mockReturnThis();
		const mockEq4 = vi.fn().mockReturnThis();
		const mockSingle3 = vi.fn().mockResolvedValue({
			data: { max_organization_members: 5 },
			error: null
		});

		const mockUpdate2 = vi.fn().mockReturnThis();
		const mockEq5 = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				// subscriptions select for organization_id
				select: mockSelect1,
				eq: mockEq1,
				single: mockSingle1
			} as any)
			.mockReturnValueOnce({
				// subscriptions update
				update: mockUpdate1,
				eq: mockEq2
			} as any)
			.mockReturnValueOnce({
				// organizations select for current stripe_subscription_id
				select: mockSelect2,
				eq: mockEq3,
				single: mockSingle2
			} as any)
			.mockReturnValueOnce({
				// plan_limits select
				select: mockSelect3,
				eq: mockEq4,
				single: mockSingle3
			} as any)
			.mockReturnValueOnce({
				// organizations update
				update: mockUpdate2,
				eq: mockEq5
			} as any);

		mockSelect1.mockReturnValue({ eq: mockEq1 } as any);
		mockEq1.mockReturnValue({ single: mockSingle1 } as any);
		mockUpdate1.mockReturnValue({ eq: mockEq2 } as any);
		mockSelect2.mockReturnValue({ eq: mockEq3 } as any);
		mockEq3.mockReturnValue({ single: mockSingle2 } as any);
		mockSelect3.mockReturnValue({ eq: mockEq4 } as any);
		mockEq4.mockReturnValue({ single: mockSingle3 } as any);
		mockUpdate2.mockReturnValue({ eq: mockEq5 } as any);

		const response = await POST(event);

		expect(response.status).toBe(200);

		// Verify subscriptions was updated to free
		expect(mockUpdate1).toHaveBeenCalledWith({
			plan_type: 'free',
			status: 'canceled',
			stripe_subscription_id: null,
			organization_id: null
		});

		// Verify organizations was downgraded to free
		expect(mockUpdate2).toHaveBeenCalledWith({
			plan_type: 'free',
			max_members: 5
		});
		expect(mockEq5).toHaveBeenCalledWith('id', 'org_123');
	});

	it('旧subscription削除（アップグレード中）では組織を更新しない', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock customer.subscription.deleted event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.deleted',
			data: {
				object: {
					id: 'sub_old_123' // Old subscription being deleted
				}
			}
		} as any);

		// Mock Supabase operations
		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: { organization_id: 'org_123' },
			error: null
		});

		const mockUpdate1 = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });

		const mockSelect2 = vi.fn().mockReturnThis();
		const mockEq3 = vi.fn().mockReturnThis();
		const mockSingle2 = vi.fn().mockResolvedValue({
			// Current subscription is different (upgraded)
			data: { stripe_subscription_id: 'sub_new_123' },
			error: null
		});

		mockSupabaseClient.from
			.mockReturnValueOnce({
				// subscriptions select for organization_id
				select: mockSelect1,
				eq: mockEq1,
				single: mockSingle1
			} as any)
			.mockReturnValueOnce({
				// subscriptions update
				update: mockUpdate1,
				eq: mockEq2
			} as any)
			.mockReturnValueOnce({
				// organizations select for current stripe_subscription_id
				select: mockSelect2,
				eq: mockEq3,
				single: mockSingle2
			} as any);

		mockSelect1.mockReturnValue({ eq: mockEq1 } as any);
		mockEq1.mockReturnValue({ single: mockSingle1 } as any);
		mockUpdate1.mockReturnValue({ eq: mockEq2 } as any);
		mockSelect2.mockReturnValue({ eq: mockEq3 } as any);
		mockEq3.mockReturnValue({ single: mockSingle2 } as any);

		const response = await POST(event);

		expect(response.status).toBe(200);

		// Verify subscriptions was updated to free
		expect(mockUpdate1).toHaveBeenCalledWith({
			plan_type: 'free',
			status: 'canceled',
			stripe_subscription_id: null,
			organization_id: null
		});

		// Verify organizations was NOT updated (only 3 from() calls, not 5)
		expect(mockSupabaseClient.from).toHaveBeenCalledTimes(3);
	});
});
