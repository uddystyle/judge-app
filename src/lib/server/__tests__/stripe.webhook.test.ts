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
	STRIPE_SECRET_KEY: 'sk_test_mock_key', // T14: テスト環境として設定
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

describe('livemode検証（T14）', () => {
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

	it('テスト環境でlivemode=trueのイベントを受信した場合は200を返しDB更新をスキップする（T14）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock constructEvent to return a livemode=true event in test environment
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_livemode_mismatch',
			type: 'customer.subscription.created',
			livemode: true, // T14: 本番イベント（テスト環境では不一致）
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					items: {
						data: [
							{
								price: {
									id: 'price_standard_month',
									recurring: { interval: 'month' }
								}
							}
						]
					}
				}
			}
		} as any);

		const response = await POST(event);

		// T14: livemode不一致時は200で応答しDB更新をスキップ
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toEqual({
			received: true,
			skipped: true,
			reason: 'livemode_mismatch'
		});

		// T14: DB更新が呼ばれていないことを確認
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('テスト環境でlivemode=falseのイベントを受信した場合は通常処理を行う（T14）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock constructEvent to return a livemode=false event in test environment (match)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_livemode_match',
			type: 'customer.created', // Unhandled event type (won't trigger DB operations)
			livemode: false, // T14: テストイベント（テスト環境で一致）
			data: {
				object: {
					id: 'cus_test_123'
				}
			}
		} as any);

		const response = await POST(event);

		// T14: livemode一致時は通常処理（未対応イベントなので200返却）
		expect(response.status).toBe(200);
		const body = await response.json();
		// 未対応イベントのレスポンス
		expect(body).toEqual({ received: true });
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

	// ============================================================
	// T11: customer.subscription.updated の未知Price ID防御
	// ============================================================

	it('customer.subscription.updatedで未知price IDの場合は500を返す（T11）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock constructEvent to return subscription.updated event with unknown price ID
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.updated',
			data: {
				object: {
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
									id: 'price_unknown_plan', // T11: Unknown price ID
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

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('未知のprice ID');
		}

		// T11: Verify no database operations were performed
		// getPlanTypeFromPrice throws before any DB calls
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('customer.subscription.updatedでitems.dataが空配列の場合は500を返す（T11）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock constructEvent to return subscription.updated event with empty items.data
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active',
					current_period_start: 1640995200,
					current_period_end: 1643673600,
					cancel_at_period_end: false,
					items: {
						data: [] // T11: Empty array - invalid
					}
				}
			}
		} as any);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('items.data');
		}

		// T11: Verify no database operations were performed
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('customer.subscription.updatedでpriceが欠落している場合は500を返す（T11）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock constructEvent to return subscription.updated event with missing price
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active',
					current_period_start: 1640995200,
					current_period_end: 1643673600,
					cancel_at_period_end: false,
					items: {
						data: [
							{
								// T11: Missing price field
								recurring: {
									interval: 'month'
								}
							}
						]
					}
				}
			}
		} as any);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('price');
		}

		// T11: Verify no database operations were performed
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
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

describe('重複配送の強化（T5）', () => {
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

	it('異なるevent.idで同一subscription.idの個人課金が二重反映されない（T5）', async () => {
		const createEvent = () => {
			const request = createMockRequest('valid_signature', 'webhook_body');
			return { request } as RequestEvent;
		};

		// Mock stripe.subscriptions.retrieve
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_same_123',
			customer: 'cus_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
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

		// T5: 最終状態を追跡するためのDB状態シミュレーション
		const dbState: Record<string, any> = {};

		// Mock Supabase upsert with DB state tracking
		const mockUpsert = vi.fn().mockImplementation((record, options) => {
			const key = options.onConflict === 'user_id' ? record.user_id : record.stripe_subscription_id;

			// Simulate upsert behavior: overwrite existing record
			dbState[key] = { ...record };

			return Promise.resolve({ data: null, error: null });
		});

		mockSupabaseClient.from.mockReturnValue({
			upsert: mockUpsert
		} as any);

		// First event: evt_first_123 with subscription sub_same_123
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_first_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_same_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'false'
					}
				}
			}
		} as any);

		const response1 = await POST(createEvent());
		expect(response1.status).toBe(200);

		// Second event: evt_second_456 with SAME subscription sub_same_123 (different event.id)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_second_456',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_same_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'false'
					}
				}
			}
		} as any);

		const response2 = await POST(createEvent());
		expect(response2.status).toBe(200);

		// T5: べき等性の検証 - upsertが2回呼ばれた
		expect(mockUpsert).toHaveBeenCalledTimes(2);

		// T5: 最終状態の検証 - DBには1件のみ存在（重複なし）
		const finalRecords = Object.values(dbState);
		expect(finalRecords.length).toBe(1);

		// T5: 最終レコードの一意性検証 - 同一subscription_idで上書きされている
		expect(finalRecords[0]).toMatchObject({
			user_id: 'user_123',
			stripe_subscription_id: 'sub_same_123',
			plan_type: 'basic'
		});

		// T5: 両方のupsert呼び出しが同じキーで実行されたことを確認
		const call1 = mockUpsert.mock.calls[0];
		const call2 = mockUpsert.mock.calls[1];

		expect(call1[0].user_id).toBe('user_123');
		expect(call2[0].user_id).toBe('user_123');
		expect(call1[0].stripe_subscription_id).toBe('sub_same_123');
		expect(call2[0].stripe_subscription_id).toBe('sub_same_123');
		expect(call1[1].onConflict).toBe('user_id');
		expect(call2[1].onConflict).toBe('user_id');
	});

	it('異なるevent.idで同一subscription.idの組織課金が二重反映されない（T5）', async () => {
		const createEvent = () => {
			const request = createMockRequest('valid_signature', 'webhook_body');
			return { request } as RequestEvent;
		};

		// Mock stripe.subscriptions.retrieve
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_org_same_123',
			customer: 'cus_org_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
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

		// T5: 最終状態を追跡するためのDB状態シミュレーション
		const organizationsDB: Record<string, any> = {};
		const organizationMembersDB: Array<any> = [];
		const subscriptionsDB: Record<string, any> = {};

		// Mock Supabase operations with DB state tracking
		const mockUpsert1 = vi.fn().mockImplementation((record, options) => {
			const key = record.stripe_subscription_id;
			organizationsDB[key] = { ...record };
			return {
				select: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: { id: 'org_123' },
					error: null
				})
			};
		});

		const mockUpsert2 = vi.fn().mockImplementation((record) => {
			// Simulate upsert for organization_members (may create duplicates if not properly constrained)
			const existingIndex = organizationMembersDB.findIndex(
				(m) => m.organization_id === record.organization_id && m.user_id === record.user_id
			);
			if (existingIndex >= 0) {
				organizationMembersDB[existingIndex] = { ...record };
			} else {
				organizationMembersDB.push({ ...record });
			}
			return Promise.resolve({ data: null, error: null });
		});

		const mockUpsert3 = vi.fn().mockImplementation((record, options) => {
			const key = record.stripe_subscription_id;
			subscriptionsDB[key] = { ...record };
			return Promise.resolve({ data: null, error: null });
		});

		mockSupabaseClient.from
			// First event (3 from() calls)
			.mockReturnValueOnce({ upsert: mockUpsert1 } as any)
			.mockReturnValueOnce({ upsert: mockUpsert2 } as any)
			.mockReturnValueOnce({ upsert: mockUpsert3 } as any)
			// Second event (3 from() calls)
			.mockReturnValueOnce({ upsert: mockUpsert1 } as any)
			.mockReturnValueOnce({ upsert: mockUpsert2 } as any)
			.mockReturnValueOnce({ upsert: mockUpsert3 } as any);

		// First event: evt_org_first_123 with subscription sub_org_same_123
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_org_first_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_org_test_123',
					customer: 'cus_org_test_123',
					subscription: 'sub_org_same_123',
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

		const response1 = await POST(createEvent());
		expect(response1.status).toBe(200);

		// Second event: evt_org_second_456 with SAME subscription sub_org_same_123 (different event.id)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_org_second_456',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_org_test_123',
					customer: 'cus_org_test_123',
					subscription: 'sub_org_same_123',
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

		const response2 = await POST(createEvent());
		expect(response2.status).toBe(200);

		// T5: べき等性の検証 - upsertが2回呼ばれた
		expect(mockUpsert1).toHaveBeenCalledTimes(2);
		expect(mockUpsert2).toHaveBeenCalledTimes(2);
		expect(mockUpsert3).toHaveBeenCalledTimes(2);

		// T5: 最終状態の検証 - 各テーブルに重複レコードがない

		// 1. organizations: 1件のみ存在（stripe_subscription_id で一意）
		const finalOrganizations = Object.values(organizationsDB);
		expect(finalOrganizations.length).toBe(1);
		expect(finalOrganizations[0]).toMatchObject({
			stripe_subscription_id: 'sub_org_same_123',
			plan_type: 'standard',
			max_members: 30
		});

		// 2. organization_members: 1件のみ存在（organization_id + user_id で一意）
		expect(organizationMembersDB.length).toBe(1);
		expect(organizationMembersDB[0]).toMatchObject({
			organization_id: 'org_123',
			user_id: 'user_123',
			role: 'admin'
		});

		// 3. subscriptions: 1件のみ存在（stripe_subscription_id で一意）
		const finalSubscriptions = Object.values(subscriptionsDB);
		expect(finalSubscriptions.length).toBe(1);
		expect(finalSubscriptions[0]).toMatchObject({
			organization_id: 'org_123',
			stripe_subscription_id: 'sub_org_same_123',
			plan_type: 'standard'
		});

		// T5: onConflictパラメータの検証
		expect(mockUpsert1).toHaveBeenCalledWith(
			expect.objectContaining({
				stripe_subscription_id: 'sub_org_same_123'
			}),
			{
				onConflict: 'stripe_subscription_id',
				ignoreDuplicates: false
			}
		);

		expect(mockUpsert3).toHaveBeenCalledWith(
			expect.objectContaining({
				stripe_subscription_id: 'sub_org_same_123'
			}),
			{
				onConflict: 'stripe_subscription_id',
				ignoreDuplicates: false
			}
		);
	});
});

describe('DB部分失敗後の再実行収束（T6）', () => {
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

	it('organization_members失敗後の再送で整合状態へ収束する（T6）', async () => {
		const createEvent = () => {
			const request = createMockRequest('valid_signature', 'webhook_body');
			return { request } as RequestEvent;
		};

		// Mock checkout.session.completed event (organization new)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
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
			current_period_end: 1672531200,
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

		// First attempt: organization_members fails
		const mockUpsert1 = vi.fn().mockReturnThis();
		const mockSelect = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: { id: 'org_123' },
			error: null
		});
		const mockUpsert2Fail = vi.fn().mockResolvedValue({
			data: null,
			error: { message: 'Database connection error', code: 'CONNECTION_ERROR' }
		});
		const mockUpsert3 = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				upsert: mockUpsert1
			} as any)
			.mockReturnValueOnce({
				upsert: mockUpsert2Fail
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

		// First execution (organization_members fails but processing continues)
		const response1 = await POST(createEvent());
		expect(response1.status).toBe(200); // Should succeed despite member error

		// Verify organization and subscription were created
		expect(mockUpsert1).toHaveBeenCalledTimes(1);
		expect(mockUpsert3).toHaveBeenCalledTimes(1);

		// Second attempt: organization_members succeeds
		const mockUpsert2Success = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				upsert: mockUpsert1
			} as any)
			.mockReturnValueOnce({
				upsert: mockUpsert2Success
			} as any)
			.mockReturnValueOnce({
				upsert: mockUpsert3
			} as any);

		const response2 = await POST(createEvent());
		expect(response2.status).toBe(200);

		// Verify member was successfully added on second attempt
		expect(mockUpsert2Success).toHaveBeenCalledWith(
			expect.objectContaining({
				organization_id: 'org_123',
				user_id: 'user_123',
				role: 'admin'
			}),
			{
				onConflict: 'organization_id,user_id',
				ignoreDuplicates: false
			}
		);
	});

	it('subscriptions失敗後の再送で整合状態へ収束する（T6）', async () => {
		const createEvent = () => {
			const request = createMockRequest('valid_signature', 'webhook_body');
			return { request } as RequestEvent;
		};

		// Mock checkout.session.completed event (organization new)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
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
			current_period_end: 1672531200,
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

		// First attempt: subscriptions upsert fails
		const mockUpsert1 = vi.fn().mockReturnThis();
		const mockSelect = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: { id: 'org_123' },
			error: null
		});
		const mockUpsert2 = vi.fn().mockResolvedValue({ data: null, error: null });
		const mockUpsert3Fail = vi.fn().mockResolvedValue({
			data: null,
			error: { message: 'Database connection error', code: 'CONNECTION_ERROR' }
		});

		mockSupabaseClient.from
			.mockReturnValueOnce({
				upsert: mockUpsert1
			} as any)
			.mockReturnValueOnce({
				upsert: mockUpsert2
			} as any)
			.mockReturnValueOnce({
				upsert: mockUpsert3Fail
			} as any);

		mockUpsert1.mockReturnValue({
			select: mockSelect
		} as any);

		mockSelect.mockReturnValue({
			single: mockSingle
		} as any);

		// First execution should fail with RetryableError (500)
		try {
			await POST(createEvent());
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('subscription作成/更新エラー');
		}

		// Verify organization and member were created
		expect(mockUpsert1).toHaveBeenCalledTimes(1);
		expect(mockUpsert2).toHaveBeenCalledTimes(1);

		// Second attempt: subscriptions upsert succeeds
		const mockUpsert3Success = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				upsert: mockUpsert1
			} as any)
			.mockReturnValueOnce({
				upsert: mockUpsert2
			} as any)
			.mockReturnValueOnce({
				upsert: mockUpsert3Success
			} as any);

		const response2 = await POST(createEvent());
		expect(response2.status).toBe(200);

		// Verify subscription was successfully created on second attempt
		expect(mockUpsert3Success).toHaveBeenCalledWith(
			expect.objectContaining({
				stripe_subscription_id: 'sub_org_test_123',
				organization_id: 'org_123'
			}),
			{
				onConflict: 'stripe_subscription_id',
				ignoreDuplicates: false
			}
		);
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

		// Mock stripe.subscriptions.retrieve with cancel_at_period_end
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_test_123',
			current_period_start: 1640995200, // 2022-01-01 00:00:00 UTC
			current_period_end: 1672531200, // 2023-01-01 00:00:00 UTC
			cancel_at_period_end: false
		} as any);

		// T13: Mock Supabase select (for replay protection check)
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: null, // No existing record
			error: { code: 'PGRST116' }
		});

		// Mock Supabase update
		const mockUpdate = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });

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

		const response = await POST(event);

		expect(response.status).toBe(200);
		// T7: cancel_at_period_endを明示的に検証
		expect(mockUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'active',
				current_period_start: '2022-01-01T00:00:00.000Z',
				current_period_end: '2023-01-01T00:00:00.000Z',
				cancel_at_period_end: false
			})
		);
		expect(mockEq2).toHaveBeenCalledWith('stripe_subscription_id', 'sub_test_123');
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

		// T13: Mock stripe.subscriptions.retrieve (needed for period check)
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_test_123',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false
		} as any);

		// T13: Mock Supabase select (for replay protection check)
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116' }
		});

		// Mock Supabase update
		const mockUpdate = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });

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

		const response = await POST(event);

		expect(response.status).toBe(200);
		expect(mockUpdate).toHaveBeenCalledWith({
			status: 'past_due'
		});
		expect(mockEq2).toHaveBeenCalledWith('stripe_subscription_id', 'sub_test_123');
	});

	it('payment_failed後にpayment_succeededでstatus=activeに回復する（T7）', async () => {
		const createEvent = (type: string) => {
			const request = createMockRequest('valid_signature', 'webhook_body');
			return { request } as RequestEvent;
		};

		// Mock stripe.subscriptions.retrieve
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_test_123',
			current_period_start: 1640995200, // 2022-01-01
			current_period_end: 1672531200, // 2023-01-01
			cancel_at_period_end: false
		} as any);

		// T13: Mock Supabase select and update for both events
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116' }
		});

		const mockUpdate = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });

		// Mock will be called 4 times: select, update, select, update
		mockSupabaseClient.from.mockImplementation(() => {
			const callCount = mockSupabaseClient.from.mock.calls.length;
			// Odd calls (1, 3): select
			if (callCount % 2 === 1) {
				return { select: mockSelect, eq: mockEq1, single: mockSingle } as any;
			}
			// Even calls (2, 4): update
			return { update: mockUpdate, eq: mockEq2 } as any;
		});

		// 1. First: invoice.payment_failed -> status should be 'past_due'
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_failed_123',
			type: 'invoice.payment_failed',
			data: {
				object: {
					id: 'in_failed_123',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		const response1 = await POST(createEvent('invoice.payment_failed'));
		expect(response1.status).toBe(200);
		expect(mockUpdate).toHaveBeenNthCalledWith(1, {
			status: 'past_due'
		});

		// 2. Second: invoice.payment_succeeded -> status should be 'active'
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_succeeded_123',
			type: 'invoice.payment_succeeded',
			data: {
				object: {
					id: 'in_succeeded_123',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		const response2 = await POST(createEvent('invoice.payment_succeeded'));
		expect(response2.status).toBe(200);
		// T7: cancel_at_period_endを明示的に検証
		expect(mockUpdate).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				status: 'active',
				current_period_start: '2022-01-01T00:00:00.000Z',
				current_period_end: '2023-01-01T00:00:00.000Z',
				cancel_at_period_end: false
			})
		);
	});

	it('cancel_at_period_end=trueが正しく保存される（T7）', async () => {
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

		// Mock stripe.subscriptions.retrieve with cancel_at_period_end=true
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_test_123',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: true
		} as any);

		// T13: Mock Supabase select and update
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116' }
		});

		const mockUpdate = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });

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

		const response = await POST(event);

		expect(response.status).toBe(200);
		// T7: cancel_at_period_end=trueを明示的に検証
		expect(mockUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'active',
				current_period_start: '2022-01-01T00:00:00.000Z',
				current_period_end: '2023-01-01T00:00:00.000Z',
				cancel_at_period_end: true
			})
		);
		expect(mockEq2).toHaveBeenCalledWith('stripe_subscription_id', 'sub_test_123');
	});

	it('cancel_at_period_end=falseが正しく保存される（T7）', async () => {
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

		// Mock stripe.subscriptions.retrieve with cancel_at_period_end=false
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
			id: 'sub_test_123',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false
		} as any);

		// T13: Mock Supabase select and update
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116' }
		});

		const mockUpdate = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });

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

		const response = await POST(event);

		expect(response.status).toBe(200);
		// T7: cancel_at_period_end=falseを明示的に検証
		expect(mockUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'active',
				current_period_start: '2022-01-01T00:00:00.000Z',
				current_period_end: '2023-01-01T00:00:00.000Z',
				cancel_at_period_end: false
			})
		);
		expect(mockEq2).toHaveBeenCalledWith('stripe_subscription_id', 'sub_test_123');
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

	it('同一subscription.idの削除イベント再送時は冪等に処理される（T16）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// First deletion event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_delete_1',
			type: 'customer.subscription.deleted',
			data: {
				object: {
					id: 'sub_test_123'
				}
			}
		} as any);

		// Mock Supabase for first deletion
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
			data: { stripe_subscription_id: 'sub_test_123' },
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
				select: mockSelect1,
				eq: mockEq1,
				single: mockSingle1
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate1,
				eq: mockEq2
			} as any)
			.mockReturnValueOnce({
				select: mockSelect2,
				eq: mockEq3,
				single: mockSingle2
			} as any)
			.mockReturnValueOnce({
				select: mockSelect3,
				eq: mockEq4,
				single: mockSingle3
			} as any)
			.mockReturnValueOnce({
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

		const response1 = await POST(event);
		expect(response1.status).toBe(200);

		// T16: Verify first deletion processed correctly
		expect(mockUpdate1).toHaveBeenCalledWith({
			plan_type: 'free',
			status: 'canceled',
			stripe_subscription_id: null,
			organization_id: null
		});
		expect(mockUpdate2).toHaveBeenCalledWith({
			plan_type: 'free',
			max_members: 5
		});

		// Second deletion event (duplicate)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_delete_2', // Different event ID
			type: 'customer.subscription.deleted',
			data: {
				object: {
					id: 'sub_test_123' // Same subscription ID
				}
			}
		} as any);

		// Mock Supabase for second deletion - organization_id is now null
		const mockSelect4 = vi.fn().mockReturnThis();
		const mockEq6 = vi.fn().mockReturnThis();
		const mockSingle4 = vi.fn().mockResolvedValue({
			data: { organization_id: null }, // T16: Already set to null by first deletion
			error: null
		});

		const mockUpdate3 = vi.fn().mockReturnThis();
		const mockEq7 = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect4,
				eq: mockEq6,
				single: mockSingle4
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate3,
				eq: mockEq7
			} as any);

		mockSelect4.mockReturnValue({ eq: mockEq6 } as any);
		mockEq6.mockReturnValue({ single: mockSingle4 } as any);
		mockUpdate3.mockReturnValue({ eq: mockEq7 } as any);

		const response2 = await POST(event);
		expect(response2.status).toBe(200);

		// T16: Verify second deletion is idempotent - subscriptions is updated again but organizations is NOT
		expect(mockUpdate3).toHaveBeenCalledWith({
			plan_type: 'free',
			status: 'canceled',
			stripe_subscription_id: null,
			organization_id: null
		});

		// T16: organizations update was NOT called for second deletion (only 2 from() calls: select + update subscriptions)
		// First deletion: 5 from() calls (select sub, update sub, select org, select plan_limits, update org)
		// Second deletion: 2 from() calls (select sub, update sub)
		expect(mockSupabaseClient.from).toHaveBeenCalledTimes(7);
	});
});

describe('checkout.session.completed metadata検証（T1）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('is_organizationが欠落している場合は400を返す（T1）', async () => {
		const event = {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers: {
					'stripe-signature': 'valid_signature'
				},
				body: JSON.stringify({})
			}),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123'
						// is_organization missing
					}
				}
			}
		});

		try {
			await POST(event);
			expect.fail('Expected NonRetryableError');
		} catch (err: any) {
			expect(err.status).toBe(400);
			expect(err.body?.message).toContain('is_organization');
		}
	});

	it('is_organizationが不正値の場合は400を返す（T1）', async () => {
		const event = {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers: {
					'stripe-signature': 'valid_signature'
				},
				body: JSON.stringify({})
			}),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'invalid_value' // Should be 'true' or 'false'
					}
				}
			}
		});

		try {
			await POST(event);
			expect.fail('Expected NonRetryableError');
		} catch (err: any) {
			expect(err.status).toBe(400);
			expect(err.body?.message).toContain('is_organization');
		}
	});

	it('subscriptionがnullの場合は400を返す（T15）', async () => {
		const event = {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers: {
					'stripe-signature': 'valid_signature'
				},
				body: JSON.stringify({})
			}),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: null, // T15: subscription is null
					metadata: {
						user_id: 'user_123',
						is_organization: 'false'
					}
				}
			}
		});

		try {
			await POST(event);
			expect.fail('Expected NonRetryableError');
		} catch (err: any) {
			// T15: subscription欠落時はNonRetryableErrorで400を返す
			expect(err.status).toBe(400);
			expect(err.body?.message).toContain('Subscription ID');
		}

		// T15: DB更新が呼ばれていないことを確認
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('組織作成でmax_membersが数値変換不可の場合は400を返す（T1）', async () => {
		const event = {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers: {
					'stripe-signature': 'valid_signature'
				},
				body: JSON.stringify({})
			}),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'true',
						organization_name: 'Test Org',
						max_members: 'not_a_number' // Invalid number
					}
				}
			}
		});

		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_test_standard_month',
							recurring: { interval: 'month' }
						}
					}
				]
			}
		} as any);

		try {
			await POST(event);
			expect.fail('Expected NonRetryableError');
		} catch (err: any) {
			expect(err.status).toBe(400);
			expect(err.body?.message).toContain('max_members');
		}
	});

	it('組織作成でis_upgradeが不正値の場合は400を返す（T1）', async () => {
		const event = {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers: {
					'stripe-signature': 'valid_signature'
				},
				body: JSON.stringify({})
			}),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'true',
						organization_name: 'Test Org',
						max_members: '10',
						is_upgrade: 'maybe' // Should be 'true' or 'false'
					}
				}
			}
		});

		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_test_standard_month',
							recurring: { interval: 'month' }
						}
					}
				]
			}
		} as any);

		try {
			await POST(event);
			expect.fail('Expected NonRetryableError');
		} catch (err: any) {
			expect(err.status).toBe(400);
			expect(err.body?.message).toContain('is_upgrade');
		}
	});

	it('組織作成でorganization_nameが欠落している場合は400を返す（T1）', async () => {
		const event = {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers: {
					'stripe-signature': 'valid_signature'
				},
				body: JSON.stringify({})
			}),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'true',
						max_members: '10',
						is_upgrade: 'false'
						// organization_name missing
					}
				}
			}
		});

		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_test_standard_month',
							recurring: { interval: 'month' }
						}
					}
				]
			}
		} as any);

		try {
			await POST(event);
			expect.fail('Expected NonRetryableError');
		} catch (err: any) {
			expect(err.status).toBe(400);
			expect(err.body?.message).toContain('organization_name');
		}
	});
});

describe('Price ID防御（T2）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('未知のprice IDの場合は500を返す（T2）', async () => {
		const event = {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers: {
					'stripe-signature': 'valid_signature'
				},
				body: JSON.stringify({})
			}),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
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
		});

		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_unknown_invalid', // Unknown price ID
							recurring: { interval: 'month' }
						}
					}
				]
			}
		} as any);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('price');
		}

		// Verify no data was saved
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('組織作成で未知のprice IDの場合は500を返す（T2）', async () => {
		const event = {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers: {
					'stripe-signature': 'valid_signature'
				},
				body: JSON.stringify({})
			}),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'true',
						organization_name: 'Test Org',
						max_members: '10',
						is_upgrade: 'false'
					}
				}
			}
		});

		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_unknown_org', // Unknown price ID
							recurring: { interval: 'month' }
						}
					}
				]
			}
		} as any);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('price');
		}

		// Verify no data was saved
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});
});

describe('Webhook順序逆転時の最終整合性（T4）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('subscription.deleted → checkout.session.completed の逆順到着で最終状態が正しい（T4）', async () => {
		// Scenario: User deletes subscription, then Stripe sends deleted event,
		// but checkout.session.completed for a NEW subscription arrives first

		// Step 1: checkout.session.completed (new subscription)
		const mockUpsert1 = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from.mockReturnValue({
			upsert: mockUpsert1
		} as any);

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_completed_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_new_123',
					customer: 'cus_test_123',
					subscription: 'sub_new_456',
					metadata: {
						user_id: 'user_123',
						is_organization: 'false'
					}
				}
			}
		});

		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_new_456',
			status: 'active',
			current_period_start: 1672531200,
			current_period_end: 1704067200,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_1SPHtjIsuW568CJsdqnUsm9d',
							recurring: { interval: 'month' }
						}
					}
				]
			}
		} as any);

		const event1 = {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers: {
					'stripe-signature': 'valid_signature'
				},
				body: JSON.stringify({})
			}),
			locals: { supabase: mockSupabaseClient }
		} as any;

		const response1 = await POST(event1);
		expect(response1.status).toBe(200);

		// Verify new subscription was created
		expect(mockUpsert1).toHaveBeenCalledWith(
			expect.objectContaining({
				user_id: 'user_123',
				stripe_subscription_id: 'sub_new_456',
				plan_type: 'standard',
				status: 'active'
			}),
			{ onConflict: 'user_id' }
		);

		// Step 2: customer.subscription.deleted (old subscription, arrives late)
		vi.clearAllMocks();

		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116', message: 'Not found' } // Old subscription not found
		});

		mockSupabaseClient.from.mockReturnValue({
			select: mockSelect1
		} as any);

		mockSelect1.mockReturnValue({ eq: mockEq1 } as any);
		mockEq1.mockReturnValue({ single: mockSingle1 } as any);

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_deleted_123',
			type: 'customer.subscription.deleted',
			data: {
				object: {
					id: 'sub_old_123', // Old subscription ID
					customer: 'cus_test_123'
				}
			}
		});

		const event2 = {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers: {
					'stripe-signature': 'valid_signature'
				},
				body: JSON.stringify({})
			}),
			locals: { supabase: mockSupabaseClient }
		} as any;

		const response2 = await POST(event2);
		expect(response2.status).toBe(200);

		// T4: Verify that deleted event for OLD subscription was handled gracefully
		// Old subscription not found, so no update was performed
		expect(mockSelect1).toHaveBeenCalledTimes(1);
		expect(mockSupabaseClient.from).toHaveBeenCalledWith('subscriptions');
	});

	it('組織: subscription.deleted → checkout.session.completed の逆順到着で最終状態が正しい（T4）', async () => {
		// Step 1: checkout.session.completed (new organization subscription)
		const mockUpsert1 = vi.fn().mockReturnThis();
		const mockSelect = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: { id: 'org_123' },
			error: null
		});
		const mockUpsert2 = vi.fn().mockResolvedValue({ data: null, error: null });
		const mockUpsert3 = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
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

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_completed_org_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_org_new_123',
					customer: 'cus_org_test_123',
					subscription: 'sub_org_new_456',
					metadata: {
						user_id: 'user_123',
						is_organization: 'true',
						organization_name: 'Test Org',
						max_members: '10',
						is_upgrade: 'false'
					}
				}
			}
		});

		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_org_new_456',
			status: 'active',
			current_period_start: 1672531200,
			current_period_end: 1704067200,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_standard_month', // Use mocked env var value
							recurring: { interval: 'month' }
						}
					}
				]
			}
		} as any);

		const event1 = {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers: {
					'stripe-signature': 'valid_signature'
				},
				body: JSON.stringify({})
			}),
			locals: { supabase: mockSupabaseClient }
		} as any;

		const response1 = await POST(event1);
		expect(response1.status).toBe(200);

		// Verify organization and subscription were created
		expect(mockUpsert1).toHaveBeenCalled();
		expect(mockUpsert3).toHaveBeenCalledWith(
			expect.objectContaining({
				user_id: 'user_123',
				organization_id: 'org_123',
				stripe_subscription_id: 'sub_org_new_456',
				plan_type: 'standard',
				status: 'active'
			}),
			expect.any(Object)
		);

		// Step 2: customer.subscription.deleted (old subscription, arrives late)
		vi.clearAllMocks();

		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116', message: 'Not found' } // Old subscription not found
		});

		mockSupabaseClient.from.mockReturnValue({
			select: mockSelect1
		} as any);

		mockSelect1.mockReturnValue({ eq: mockEq1 } as any);
		mockEq1.mockReturnValue({ single: mockSingle1 } as any);

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_deleted_org_123',
			type: 'customer.subscription.deleted',
			data: {
				object: {
					id: 'sub_org_old_123', // Old subscription ID
					customer: 'cus_org_test_123'
				}
			}
		});

		const event2 = {
			request: new Request('http://localhost/api/stripe/webhook', {
				method: 'POST',
				headers: {
					'stripe-signature': 'valid_signature'
				},
				body: JSON.stringify({})
			}),
			locals: { supabase: mockSupabaseClient }
		} as any;

		const response2 = await POST(event2);
		expect(response2.status).toBe(200);

		// T4: Verify that deleted event for OLD subscription was handled gracefully
		// Old subscription not found, so no downgrade was performed
		expect(mockSelect1).toHaveBeenCalledTimes(1);
		expect(mockSupabaseClient.from).toHaveBeenCalledWith('subscriptions');
	});
});

describe('is_upgrade=true + organization_id欠落防御（T9）', () => {
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

	it('is_upgrade=trueかつorganization_id欠落の場合は400を返す（T9）', async () => {
		const event = {
			request: createMockRequest('valid_signature', 'webhook_body'),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'true',
						organization_name: 'Test Org',
						max_members: '10',
						is_upgrade: 'true'
						// organization_id missing - this should cause error
					}
				}
			}
		});

		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_standard_month',
							recurring: { interval: 'month' }
						}
					}
				]
			}
		} as any);

		try {
			await POST(event);
			expect.fail('Expected NonRetryableError');
		} catch (err: any) {
			expect(err.status).toBe(400);
			expect(err.body?.message).toContain('organization_id');
		}

		// T9: Verify no database operations were performed
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('is_upgrade=falseでorganization_id欠落の場合は正常に新規作成される（T9）', async () => {
		const event = {
			request: createMockRequest('valid_signature', 'webhook_body'),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'true',
						organization_name: 'Test Org',
						max_members: '10',
						is_upgrade: 'false'
						// organization_id missing is OK for new organization
					}
				}
			}
		});

		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_standard_month',
							recurring: { interval: 'month' }
						}
					}
				]
			}
		} as any);

		// Mock Supabase operations for organization creation
		const mockUpsert1 = vi.fn().mockReturnThis();
		const mockSelect = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: { id: 'org_new_123' },
			error: null
		});
		const mockUpsert2 = vi.fn().mockResolvedValue({ data: null, error: null });
		const mockUpsert3 = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({ upsert: mockUpsert1 } as any)
			.mockReturnValueOnce({ upsert: mockUpsert2 } as any)
			.mockReturnValueOnce({ upsert: mockUpsert3 } as any);

		mockUpsert1.mockReturnValue({ select: mockSelect } as any);
		mockSelect.mockReturnValue({ single: mockSingle } as any);

		const response = await POST(event);

		expect(response.status).toBe(200);

		// T9: Verify organization was created successfully
		expect(mockUpsert1).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Test Org',
				plan_type: 'standard',
				max_members: 10
			}),
			expect.any(Object)
		);
	});
});

describe('Stripe Subscriptionレスポンス異常データ防御（T10）', () => {
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

	it('subscription.items.dataが空配列の場合は500を返す（T10）', async () => {
		const event = {
			request: createMockRequest('valid_signature', 'webhook_body'),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
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
		});

		// T10: Mock subscription with empty items.data array
		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false,
			items: {
				data: [] // Empty array - invalid
			}
		} as any);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('items.data');
		}

		// T10: Verify no database operations were performed
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('subscription.items.data[0].priceがundefinedの場合は500を返す（T10）', async () => {
		const event = {
			request: createMockRequest('valid_signature', 'webhook_body'),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
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
		});

		// T10: Mock subscription with missing price
		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						// price is missing
					}
				]
			}
		} as any);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('price');
		}

		// T10: Verify no database operations were performed
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('組織作成でsubscription.items.dataが空配列の場合は500を返す（T10）', async () => {
		const event = {
			request: createMockRequest('valid_signature', 'webhook_body'),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'true',
						organization_name: 'Test Org',
						max_members: '10',
						is_upgrade: 'false'
					}
				}
			}
		});

		// T10: Mock subscription with empty items.data array
		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false,
			items: {
				data: [] // Empty array - invalid
			}
		} as any);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('items.data');
		}

		// T10: Verify no database operations were performed
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('組織作成でsubscription.items.data[0].priceがundefinedの場合は500を返す（T10）', async () => {
		const event = {
			request: createMockRequest('valid_signature', 'webhook_body'),
			locals: { supabase: mockSupabaseClient }
		} as any;

		(stripe.webhooks.constructEvent as any).mockReturnValue({
			id: 'evt_test_123',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_123',
					customer: 'cus_test_123',
					subscription: 'sub_test_123',
					metadata: {
						user_id: 'user_123',
						is_organization: 'true',
						organization_name: 'Test Org',
						max_members: '10',
						is_upgrade: 'false'
					}
				}
			}
		});

		// T10: Mock subscription with missing price
		(stripe.subscriptions.retrieve as any).mockResolvedValue({
			id: 'sub_test_123',
			status: 'active',
			current_period_start: 1640995200,
			current_period_end: 1672531200,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						// price is missing
					}
				]
			}
		} as any);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('price');
		}

		// T10: Verify no database operations were performed
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	// ============================================================
	// T10拡張: customer.subscription.created の異常データ防御
	// ============================================================

	it('subscription.createdでitems.dataが空配列の場合は500を返す（T10拡張）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock customer.subscription.created with empty items.data
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.created',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active',
					current_period_start: 1640995200,
					current_period_end: 1672531200,
					cancel_at_period_end: false,
					items: {
						data: [] // Empty array - invalid
					}
				}
			}
		} as any);

		// Mock Supabase to return existing subscription
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: { user_id: 'user_123', organization_id: null },
			error: null
		});

		mockSupabaseClient.from.mockReturnValue({
			select: mockSelect,
			eq: mockEq,
			single: mockSingle
		} as any);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('items.data');
		}

		// T10: Verify only select was called, no update
		expect(mockSupabaseClient.from).toHaveBeenCalledTimes(1);
	});

	it('subscription.createdでpriceが欠落している場合は500を返す（T10拡張）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock customer.subscription.created with missing price
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.created',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active',
					current_period_start: 1640995200,
					current_period_end: 1672531200,
					cancel_at_period_end: false,
					items: {
						data: [
							{
								// price is missing
								recurring: {
									interval: 'month'
								}
							}
						]
					}
				}
			}
		} as any);

		// Mock Supabase to return existing subscription
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: { user_id: 'user_123', organization_id: null },
			error: null
		});

		mockSupabaseClient.from.mockReturnValue({
			select: mockSelect,
			eq: mockEq,
			single: mockSingle
		} as any);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('price');
		}

		// T10: Verify only select was called, no update
		expect(mockSupabaseClient.from).toHaveBeenCalledTimes(1);
	});

	it('subscription.createdで未知price IDの場合は500を返す（T10拡張）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// Mock customer.subscription.created with unknown price ID
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.created',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active',
					current_period_start: 1640995200,
					current_period_end: 1672531200,
					cancel_at_period_end: false,
					items: {
						data: [
							{
								price: {
									id: 'price_unknown_invalid', // Unknown price ID
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

		// Mock Supabase to return existing subscription
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: { user_id: 'user_123', organization_id: null },
			error: null
		});

		mockSupabaseClient.from.mockReturnValue({
			select: mockSelect,
			eq: mockEq,
			single: mockSingle
		} as any);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('未知のprice ID');
		}

		// T10: Verify only select was called, no update
		expect(mockSupabaseClient.from).toHaveBeenCalledTimes(1);
	});
});

// ============================================================
// T13: Webhookリプレイ（古いイベント）耐性テスト
// ============================================================

describe('Webhookリプレイ耐性（T13）', () => {
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

	it('新しいinvoice.payment_succeeded後に古いinvoice.payment_failedが来てもactiveを維持する（T13）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// First: payment_succeeded event (newer, sets active status)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_new_success',
			type: 'invoice.payment_succeeded',
			data: {
				object: {
					id: 'in_test_new',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		// Mock stripe.subscriptions.retrieve for newer period
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
			id: 'sub_test_123',
			current_period_start: 1672531200, // 2023-01-01 (newer)
			current_period_end: 1675209600, // 2023-02-01 (newer)
			cancel_at_period_end: false
		} as any);

		// T13: Mock Supabase select for first event (no existing record)
		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1a = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116' } // No record found
		});

		// Mock Supabase update for first event
		const mockUpdate1 = vi.fn().mockReturnThis();
		const mockEq1b = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect1,
				eq: mockEq1a,
				single: mockSingle1
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate1,
				eq: mockEq1b
			} as any);

		// Process first event (payment_succeeded)
		const response1 = await POST(event);
		expect(response1.status).toBe(200);
		expect(mockUpdate1).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'active',
				current_period_end: '2023-02-01T00:00:00.000Z'
			})
		);

		// Second: Old payment_failed event (older period, should not override)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_old_failed',
			type: 'invoice.payment_failed',
			data: {
				object: {
					id: 'in_test_old',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		// Mock stripe.subscriptions.retrieve for older period
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
			id: 'sub_test_123',
			current_period_start: 1640995200, // 2022-01-01 (older)
			current_period_end: 1643673600, // 2022-02-01 (older)
			cancel_at_period_end: false,
			status: 'past_due'
		} as any);

		// T13: Mock Supabase select to return current (newer) state
		const mockSelect2 = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockReturnThis();
		const mockSingle2 = vi.fn().mockResolvedValue({
			data: {
				current_period_end: '2023-02-01T00:00:00.000Z' // Current newer state
			},
			error: null
		});

		mockSupabaseClient.from.mockReturnValueOnce({
			select: mockSelect2,
			eq: mockEq2,
			single: mockSingle2
		} as any);

		// Process second event (old payment_failed)
		const response2 = await POST(event);
		expect(response2.status).toBe(200);

		// T13: Verify that old event does not override newer state
		// The update should be skipped - verify select was called but update was not
		expect(mockSelect2).toHaveBeenCalled();
		expect(mockEq2).toHaveBeenCalledWith('stripe_subscription_id', 'sub_test_123');
		expect(mockSingle2).toHaveBeenCalled();

		// T13: Verify update was NOT called because event is older
		// mockSupabaseClient.from should have been called exactly 3 times:
		// 1. First event select, 2. First event update, 3. Second event select
		expect(mockSupabaseClient.from).toHaveBeenCalledTimes(3);
	});

	it('新しいcustomer.subscription.updated後に古いsubscription.updatedが来ても新しい状態を維持する（T13）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// First: newer subscription.updated event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_new_update',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active',
					current_period_start: 1672531200, // 2023-01-01 (newer)
					current_period_end: 1675209600, // 2023-02-01 (newer)
					cancel_at_period_end: false,
					items: {
						data: [
							{
								price: {
									id: 'price_1SPHvrIsuW568CJsBsRymAvZ', // Pro plan
									recurring: { interval: 'month' }
								}
							}
						]
					}
				}
			}
		} as any);

		// T13: Mock Supabase for first event (existing record with old period_end)
		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: {
				organization_id: null,
				current_period_end: '2022-12-01T00:00:00.000Z' // Older than event
			},
			error: null
		});

		const mockUpdate1 = vi.fn().mockReturnThis();
		const mockEq1b = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect1,
				eq: mockEq1,
				single: mockSingle1
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate1,
				eq: mockEq1b
			} as any);

		// Process first event (newer update)
		const response1 = await POST(event);
		expect(response1.status).toBe(200);
		expect(mockUpdate1).toHaveBeenCalledWith(
			expect.objectContaining({
				plan_type: 'pro',
				status: 'active',
				current_period_end: '2023-02-01T00:00:00.000Z'
			})
		);

		// Second: older subscription.updated event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_old_update',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active',
					current_period_start: 1640995200, // 2022-01-01 (older)
					current_period_end: 1643673600, // 2022-02-01 (older)
					cancel_at_period_end: false,
					items: {
						data: [
							{
								price: {
									id: 'price_1SPHtjIsuW568CJsdqnUsm9d', // Standard plan
									recurring: { interval: 'month' }
								}
							}
						]
					}
				}
			}
		} as any);

		// T13: Mock Supabase for second event - return current (newer) state
		const mockSelect2 = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockReturnThis();
		const mockSingle2 = vi.fn().mockResolvedValue({
			data: {
				organization_id: null,
				current_period_end: '2023-02-01T00:00:00.000Z' // Current newer state
			},
			error: null
		});

		mockSupabaseClient.from.mockReturnValueOnce({
			select: mockSelect2,
			eq: mockEq2,
			single: mockSingle2
		} as any);

		// Process second event (old update) - should not override newer state
		const response2 = await POST(event);
		expect(response2.status).toBe(200);

		// T13: Verify that old event does not override newer state
		expect(mockSelect2).toHaveBeenCalled();
		expect(mockEq2).toHaveBeenCalledWith('stripe_subscription_id', 'sub_test_123');
		expect(mockSingle2).toHaveBeenCalled();

		// T13: Verify update was NOT called because event is older
		// mockSupabaseClient.from should have been called exactly 2 times:
		// 1. First event select, 2. First event update (skip second update)
		expect(mockSupabaseClient.from).toHaveBeenCalledTimes(3);
	});

	it('削除後に再作成されたsubscriptionに対して古い削除イベントが来ても影響しない（T13）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// subscription.deleted for old subscription ID
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_old_delete',
			type: 'customer.subscription.deleted',
			data: {
				object: {
					id: 'sub_old_123', // Old subscription ID
					customer: 'cus_test_123'
				}
			}
		} as any);

		// Mock Supabase to return subscription with organization_id
		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: {
				organization_id: 'org_123',
				stripe_subscription_id: 'sub_old_123' // Matches deleted subscription
			},
			error: null
		});

		// Mock subscriptions update (will update the old subscription to free)
		const mockUpdate1 = vi.fn().mockReturnThis();
		const mockEq1b = vi.fn().mockResolvedValue({ data: null, error: null });

		// Mock organization query - returns different subscription_id (newer one)
		const mockSelect2 = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockReturnThis();
		const mockSingle2 = vi.fn().mockResolvedValue({
			data: {
				stripe_subscription_id: 'sub_new_456' // Different/newer subscription ID
			},
			error: null
		});

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect1,
				eq: mockEq1,
				single: mockSingle1
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate1,
				eq: mockEq1b
			} as any)
			.mockReturnValueOnce({
				select: mockSelect2,
				eq: mockEq2,
				single: mockSingle2
			} as any);

		const response = await POST(event);
		expect(response.status).toBe(200);

		// T13: Old delete event updates the old subscription record but does not downgrade organization
		// Verify: 1. subscriptions select, 2. subscriptions update, 3. organization select
		expect(mockSupabaseClient.from).toHaveBeenCalledTimes(3);
		expect(mockUpdate1).toHaveBeenCalled(); // Old subscription updated to free
		// No organization update should happen (mockSupabaseClient.from called only 3 times, not 4)
	});

	it('同一期間内のpast_due→active回復は正しく処理される（T13修正）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		const SAME_PERIOD_END = 1675209600; // 2023-02-01

		// First: payment_failed event -> status: past_due
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_failed',
			type: 'invoice.payment_failed',
			data: {
				object: {
					id: 'in_failed',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		// Mock stripe.subscriptions.retrieve for failed event
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
			id: 'sub_test_123',
			current_period_start: 1672531200,
			current_period_end: SAME_PERIOD_END,
			cancel_at_period_end: false,
			status: 'past_due'
		} as any);

		// T13: Mock Supabase select for first event (no existing record)
		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116' }
		});

		const mockUpdate1 = vi.fn().mockReturnThis();
		const mockEq1b = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect1,
				eq: mockEq1,
				single: mockSingle1
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate1,
				eq: mockEq1b
			} as any);

		const response1 = await POST(event);
		expect(response1.status).toBe(200);
		expect(mockUpdate1).toHaveBeenCalledWith({ status: 'past_due' });

		// Second: payment_succeeded event (SAME period) -> status: active
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_succeeded',
			type: 'invoice.payment_succeeded',
			data: {
				object: {
					id: 'in_succeeded',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		// Mock stripe.subscriptions.retrieve for succeeded event (SAME period)
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
			id: 'sub_test_123',
			current_period_start: 1672531200,
			current_period_end: SAME_PERIOD_END, // SAME period as failed event
			cancel_at_period_end: false,
			status: 'active'
		} as any);

		// T13: Mock Supabase select - return current state with SAME period_end
		const mockSelect2 = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockReturnThis();
		const mockSingle2 = vi.fn().mockResolvedValue({
			data: {
				current_period_end: new Date(SAME_PERIOD_END * 1000).toISOString() // SAME period
			},
			error: null
		});

		const mockUpdate2 = vi.fn().mockReturnThis();
		const mockEq2b = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect2,
				eq: mockEq2,
				single: mockSingle2
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate2,
				eq: mockEq2b
			} as any);

		const response2 = await POST(event);
		expect(response2.status).toBe(200);

		// T13修正: 同一期間内の回復イベントは処理される（スキップされない）
		expect(mockSelect2).toHaveBeenCalled();
		expect(mockUpdate2).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'active',
				current_period_end: new Date(SAME_PERIOD_END * 1000).toISOString()
			})
		);
	});

	it('subscription.updatedで同一期間内のcancel_at_period_end変更は正しく処理される（T13修正）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		const SAME_PERIOD_END = 1675209600; // 2023-02-01

		// subscription.updated event with cancel_at_period_end=true (SAME period)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_cancel_scheduled',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active',
					current_period_start: 1672531200,
					current_period_end: SAME_PERIOD_END, // SAME period
					cancel_at_period_end: true, // Changed to true
					items: {
						data: [
							{
								price: {
									id: 'price_1SPHvrIsuW568CJsBsRymAvZ', // Pro plan
									recurring: { interval: 'month' }
								}
							}
						]
					}
				}
			}
		} as any);

		// T13: Mock Supabase select - return current state with SAME period but cancel_at_period_end=false
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: {
				organization_id: null,
				current_period_end: new Date(SAME_PERIOD_END * 1000).toISOString() // SAME period
				// cancel_at_period_end was false before
			},
			error: null
		});

		const mockUpdate = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect,
				eq: mockEq,
				single: mockSingle
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate,
				eq: mockEq2
			} as any);

		const response = await POST(event);
		expect(response.status).toBe(200);

		// T13修正: 同一期間内でもcancel_at_period_end変更は処理される（スキップされない）
		expect(mockSelect).toHaveBeenCalled();
		expect(mockUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				plan_type: 'pro',
				status: 'active',
				current_period_end: new Date(SAME_PERIOD_END * 1000).toISOString(),
				cancel_at_period_end: true // Updated to true
			})
		);
	});

	it('subscription.updatedで同一期間内のプラン変更は正しく処理される（T13修正）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		const SAME_PERIOD_END = 1675209600; // 2023-02-01

		// subscription.updated event with plan change (SAME period)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_plan_change',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active',
					current_period_start: 1672531200,
					current_period_end: SAME_PERIOD_END, // SAME period
					cancel_at_period_end: false,
					items: {
						data: [
							{
								price: {
									id: 'price_1SPHvrIsuW568CJsBsRymAvZ', // Changed to Pro plan
									recurring: { interval: 'month' }
								}
							}
						]
					}
				}
			}
		} as any);

		// T13: Mock Supabase select - return current state with SAME period but different plan
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: {
				organization_id: null,
				current_period_end: new Date(SAME_PERIOD_END * 1000).toISOString() // SAME period
				// plan_type was 'standard' before
			},
			error: null
		});

		const mockUpdate = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect,
				eq: mockEq,
				single: mockSingle
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate,
				eq: mockEq2
			} as any);

		const response = await POST(event);
		expect(response.status).toBe(200);

		// T13修正: 同一期間内でもプラン変更は処理される（スキップされない）
		expect(mockSelect).toHaveBeenCalled();
		expect(mockUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				plan_type: 'pro', // Changed from standard to pro
				status: 'active',
				current_period_end: new Date(SAME_PERIOD_END * 1000).toISOString()
			})
		);
	});

	// ============================================================
	// T13冪等性: 完全重複イベント（同一period_end + 同一status）の処理
	// ============================================================

	it('invoice.payment_succeededで同一period_end+同一statusの完全重複イベントはDB更新を省略する（T13最適化）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		const SAME_PERIOD_END = 1675209600; // 2023-02-01

		// First: payment_succeeded event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_first',
			type: 'invoice.payment_succeeded',
			data: {
				object: {
					id: 'in_first',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
			id: 'sub_test_123',
			current_period_start: 1672531200,
			current_period_end: SAME_PERIOD_END,
			cancel_at_period_end: false
		} as any);

		// Mock Supabase for first event
		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116' } // No existing record
		});

		const mockUpdate1 = vi.fn().mockReturnThis();
		const mockEq1b = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect1,
				eq: mockEq1,
				single: mockSingle1
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate1,
				eq: mockEq1b
			} as any);

		const response1 = await POST(event);
		expect(response1.status).toBe(200);
		expect(mockUpdate1).toHaveBeenCalled(); // First event: DB updated

		// Second: Duplicate payment_succeeded event (SAME period_end, SAME status)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_duplicate', // Different event ID
			type: 'invoice.payment_succeeded',
			data: {
				object: {
					id: 'in_duplicate',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
			id: 'sub_test_123',
			current_period_start: 1672531200, // SAME
			current_period_end: SAME_PERIOD_END, // SAME
			cancel_at_period_end: false // SAME
		} as any);

		// Mock Supabase for duplicate event - return existing state with SAME values
		const mockSelect2 = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockReturnThis();
		const mockSingle2 = vi.fn().mockResolvedValue({
			data: {
				current_period_end: new Date(SAME_PERIOD_END * 1000).toISOString(), // SAME
				status: 'active', // SAME
				cancel_at_period_end: false // SAME
			},
			error: null
		});

		mockSupabaseClient.from.mockReturnValueOnce({
			select: mockSelect2,
			eq: mockEq2,
			single: mockSingle2
		} as any);

		const response2 = await POST(event);
		expect(response2.status).toBe(200);

		// T13最適化: 同一内容の重複イベントはDB更新を省略（書き込み削減）
		expect(mockSelect2).toHaveBeenCalled(); // Select is called to check
		// mockUpdate2は作成されない（fromが1回しか呼ばれない）= DB更新が省略された
		expect(mockSupabaseClient.from).toHaveBeenCalledTimes(3); // 1st: select, 2nd: update, 3rd: select only
	});

	it('subscription.updatedで同一period_end+同一内容の完全重複イベントはDB更新を省略する（T13最適化）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		const SAME_PERIOD_END = 1675209600; // 2023-02-01

		// First: subscription.updated event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_first',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active',
					current_period_start: 1672531200,
					current_period_end: SAME_PERIOD_END,
					cancel_at_period_end: false,
					items: {
						data: [
							{
								price: {
									id: 'price_1SPHvrIsuW568CJsBsRymAvZ', // Pro plan
									recurring: { interval: 'month' }
								}
							}
						]
					}
				}
			}
		} as any);

		// Mock Supabase for first event
		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: {
				organization_id: null,
				current_period_end: new Date(1672531200 * 1000).toISOString(), // Older period
				status: 'active',
				cancel_at_period_end: false,
				plan_type: 'free',
				billing_interval: 'month'
			},
			error: null
		});

		const mockUpdate1 = vi.fn().mockReturnThis();
		const mockEq1b = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect1,
				eq: mockEq1,
				single: mockSingle1
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate1,
				eq: mockEq1b
			} as any);

		const response1 = await POST(event);
		expect(response1.status).toBe(200);
		expect(mockUpdate1).toHaveBeenCalled(); // First event: DB updated

		// Second: Duplicate subscription.updated event (SAME everything)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_duplicate', // Different event ID
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active', // SAME
					current_period_start: 1672531200, // SAME
					current_period_end: SAME_PERIOD_END, // SAME
					cancel_at_period_end: false, // SAME
					items: {
						data: [
							{
								price: {
									id: 'price_1SPHvrIsuW568CJsBsRymAvZ', // SAME Pro plan
									recurring: { interval: 'month' } // SAME
								}
							}
						]
					}
				}
			}
		} as any);

		// Mock Supabase for duplicate event - return existing state with SAME values
		const mockSelect2 = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockReturnThis();
		const mockSingle2 = vi.fn().mockResolvedValue({
			data: {
				organization_id: null,
				current_period_end: new Date(SAME_PERIOD_END * 1000).toISOString(), // SAME
				status: 'active', // SAME
				cancel_at_period_end: false, // SAME
				plan_type: 'pro', // SAME as event (updated by first event)
				billing_interval: 'month' // SAME
			},
			error: null
		});

		mockSupabaseClient.from.mockReturnValueOnce({
			select: mockSelect2,
			eq: mockEq2,
			single: mockSingle2
		} as any);

		const response2 = await POST(event);
		expect(response2.status).toBe(200);

		// T13最適化: 同一内容の重複イベントはDB更新を省略（書き込み削減）
		expect(mockSelect2).toHaveBeenCalled(); // Select is called to check
		// mockUpdate2は作成されない（fromが1回しか呼ばれない）= DB更新が省略された
		expect(mockSupabaseClient.from).toHaveBeenCalledTimes(3); // 1st: select, 2nd: update, 3rd: select only
	});

	it('異なるevent.idでも同一内容のイベントはDB更新を省略する（T13最適化）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		const SAME_PERIOD_END = 1675209600; // 2023-02-01

		// First: New event with no existing record
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_1', // First event ID
			type: 'invoice.payment_succeeded',
			data: {
				object: {
					id: 'in_1',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
			id: 'sub_test_123',
			current_period_start: 1672531200,
			current_period_end: SAME_PERIOD_END,
			cancel_at_period_end: false
		} as any);

		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116' } // No existing record
		});

		const mockUpdate1 = vi.fn().mockReturnThis();
		const mockEqUpdate1 = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect1,
				eq: mockEq1,
				single: mockSingle1
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate1,
				eq: mockEqUpdate1
			} as any);

		const response1 = await POST(event);
		expect(response1.status).toBe(200);
		expect(mockUpdate1).toHaveBeenCalled(); // First event: DB updated

		// Second: Same content with different event ID
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_2', // Different event ID
			type: 'invoice.payment_succeeded',
			data: {
				object: {
					id: 'in_2',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
			id: 'sub_test_123',
			current_period_start: 1672531200, // SAME
			current_period_end: SAME_PERIOD_END, // SAME
			cancel_at_period_end: false // SAME
		} as any);

		const mockSelect2 = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockReturnThis();
		const mockSingle2 = vi.fn().mockResolvedValue({
			data: {
				current_period_end: new Date(SAME_PERIOD_END * 1000).toISOString(), // SAME
				status: 'active', // SAME
				cancel_at_period_end: false // SAME
			},
			error: null
		});

		mockSupabaseClient.from.mockReturnValueOnce({
			select: mockSelect2,
			eq: mockEq2,
			single: mockSingle2
		} as any);

		const response2 = await POST(event);
		expect(response2.status).toBe(200);

		// T13最適化: 異なるevent.idでも同じ内容ならDB更新を省略（書き込み削減）
		// Stripe webhook redeliveryの仕様: 同じイベントが再送される場合、event.idは同じだが、
		// 手動リプレイや複数のwebhook endpointからの配信では異なるevent.idになる可能性がある
		// いずれの場合でも、同じ内容ならDB更新を省略する
		expect(mockSelect2).toHaveBeenCalled(); // Select is called to check
		expect(mockSupabaseClient.from).toHaveBeenCalledTimes(3); // 1st: select, 2nd: update, 3rd: select only
	});

	it('invoice.payment_failedで同一period_end+同一statusの完全重複イベントはDB更新を省略する（T13最適化）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		const SAME_PERIOD_END = 1675209600; // 2023-02-01

		// First: payment_failed event
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_first',
			type: 'invoice.payment_failed',
			data: {
				object: {
					id: 'in_first',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
			id: 'sub_test_123',
			current_period_start: 1672531200,
			current_period_end: SAME_PERIOD_END
		} as any);

		// Mock Supabase for first event
		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: {
				current_period_end: new Date(SAME_PERIOD_END * 1000).toISOString(),
				status: 'active' // Before failure
			},
			error: null
		});

		const mockUpdate1 = vi.fn().mockReturnThis();
		const mockEq1b = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect1,
				eq: mockEq1,
				single: mockSingle1
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate1,
				eq: mockEq1b
			} as any);

		const response1 = await POST(event);
		expect(response1.status).toBe(200);
		expect(mockUpdate1).toHaveBeenCalledWith({ status: 'past_due' }); // First event: DB updated

		// Second: Duplicate payment_failed event (SAME period_end, SAME status)
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_duplicate', // Different event ID
			type: 'invoice.payment_failed',
			data: {
				object: {
					id: 'in_duplicate',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
			id: 'sub_test_123',
			current_period_start: 1672531200, // SAME
			current_period_end: SAME_PERIOD_END // SAME
		} as any);

		// Mock Supabase for duplicate event - return existing state with SAME values
		const mockSelect2 = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockReturnThis();
		const mockSingle2 = vi.fn().mockResolvedValue({
			data: {
				current_period_end: new Date(SAME_PERIOD_END * 1000).toISOString(), // SAME
				status: 'past_due' // SAME (already updated by first event)
			},
			error: null
		});

		mockSupabaseClient.from.mockReturnValueOnce({
			select: mockSelect2,
			eq: mockEq2,
			single: mockSingle2
		} as any);

		const response2 = await POST(event);
		expect(response2.status).toBe(200);

		// T13最適化: 同一内容の重複イベントはDB更新を省略（書き込み削減）
		expect(mockSelect2).toHaveBeenCalled(); // Select is called to check
		// mockUpdate2は作成されない（fromが1回しか呼ばれない）= DB更新が省略された
		expect(mockSupabaseClient.from).toHaveBeenCalledTimes(3); // 1st: select, 2nd: update, 3rd: select only
	});
});

describe('plan_limits欠落時のエラー処理（T17）', () => {
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


	it('subscription.updated（組織プラン変更）時にplan_limitsが見つからない場合は400を返す（T17）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.updated',
			data: {
				object: {
					id: 'sub_test_123',
					customer: 'cus_test_123',
					status: 'active',
					current_period_start: 1672531200,
					current_period_end: 1675209600,
					cancel_at_period_end: false,
					items: {
						data: [
							{
								price: {
									id: 'price_premium_month',
									recurring: { interval: 'month' }
								}
							}
						]
					}
				}
			}
		} as any);

		// Mock Supabase: subscription exists with organization_id
		const mockSelect1 = vi.fn().mockReturnThis();
		const mockEq1 = vi.fn().mockReturnThis();
		const mockSingle1 = vi.fn().mockResolvedValue({
			data: {
				organization_id: 'org_123',
				current_period_end: new Date(1672531200 * 1000).toISOString(),
				status: 'active',
				cancel_at_period_end: false,
				plan_type: 'standard',
				billing_interval: 'month'
			},
			error: null
		});

		const mockUpdate1 = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });

		// T17: plan_limits取得失敗
		const mockSelect2 = vi.fn().mockReturnThis();
		const mockEq3 = vi.fn().mockReturnThis();
		const mockSingle2 = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116', message: 'No rows found' } // T17: plan_limits not found
		});

		mockSupabaseClient.from
			.mockReturnValueOnce({ select: mockSelect1, eq: mockEq1, single: mockSingle1 } as any)
			.mockReturnValueOnce({ update: mockUpdate1, eq: mockEq2 } as any)
			.mockReturnValueOnce({ select: mockSelect2, eq: mockEq3, single: mockSingle2 } as any);

		mockSelect1.mockReturnValue({ eq: mockEq1 } as any);
		mockEq1.mockReturnValue({ single: mockSingle1 } as any);
		mockUpdate1.mockReturnValue({ eq: mockEq2 } as any);
		mockSelect2.mockReturnValue({ eq: mockEq3 } as any);
		mockEq3.mockReturnValue({ single: mockSingle2 } as any);

		try {
			await POST(event);
			expect.fail('Expected NonRetryableError');
		} catch (err: any) {
			// T17: plan_limits欠落はNonRetryableError(400)
			expect(err.status).toBe(400);
			expect(err.body?.message).toContain('plan_limits');
		}
	});

	it('subscription.deleted（組織降格）時にplan_limitsが見つからない場合は400を返す（T17）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
			id: 'evt_test_123',
			type: 'customer.subscription.deleted',
			data: {
				object: {
					id: 'sub_test_123'
				}
			}
		} as any);

		// Mock Supabase: subscription exists with organization_id
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
			data: { stripe_subscription_id: 'sub_test_123' }, // Current subscription matches
			error: null
		});

		// T17: plan_limits取得失敗（フリープラン）
		const mockSelect3 = vi.fn().mockReturnThis();
		const mockEq4 = vi.fn().mockReturnThis();
		const mockSingle3 = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116', message: 'No rows found' } // T17: plan_limits not found
		});

		mockSupabaseClient.from
			.mockReturnValueOnce({ select: mockSelect1, eq: mockEq1, single: mockSingle1 } as any)
			.mockReturnValueOnce({ update: mockUpdate1, eq: mockEq2 } as any)
			.mockReturnValueOnce({ select: mockSelect2, eq: mockEq3, single: mockSingle2 } as any)
			.mockReturnValueOnce({ select: mockSelect3, eq: mockEq4, single: mockSingle3 } as any);

		mockSelect1.mockReturnValue({ eq: mockEq1 } as any);
		mockEq1.mockReturnValue({ single: mockSingle1 } as any);
		mockUpdate1.mockReturnValue({ eq: mockEq2 } as any);
		mockSelect2.mockReturnValue({ eq: mockEq3 } as any);
		mockEq3.mockReturnValue({ single: mockSingle2 } as any);
		mockSelect3.mockReturnValue({ eq: mockEq4 } as any);
		mockEq4.mockReturnValue({ single: mockSingle3 } as any);

		try {
			await POST(event);
			expect.fail('Expected NonRetryableError');
		} catch (err: any) {
			// T17: plan_limits欠落はNonRetryableError(400)
			expect(err.status).toBe(400);
			expect(err.body?.message).toContain('plan_limits');
		}
	});
});

describe('Stripe API一時障害後の再送回復（T18）', () => {
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

	it('invoice.payment_succeededでsubscription取得が初回失敗しても再送時に成功すれば正しい状態に収束する（T18）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// First attempt: subscription.retrieve fails
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_test_123',
			type: 'invoice.payment_succeeded',
			data: {
				object: {
					id: 'in_test_123',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		// T18: Stripe API一時障害をシミュレート
		vi.mocked(stripe.subscriptions.retrieve).mockRejectedValueOnce(
			new Error('Stripe API timeout')
		);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			// T18: Stripe API失敗はRetryableError(500)で再送を促す
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('Stripe API');
		}

		// Second attempt: subscription.retrieve succeeds
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_test_123', // Same event ID (Stripe webhook retry)
			type: 'invoice.payment_succeeded',
			data: {
				object: {
					id: 'in_test_123',
					subscription: 'sub_test_123'
				}
			}
		} as any);

		// T18: Stripe API回復
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
			id: 'sub_test_123',
			current_period_start: 1672531200,
			current_period_end: 1675209600,
			cancel_at_period_end: false
		} as any);

		// Mock Supabase for successful processing
		const mockSelect = vi.fn().mockReturnThis();
		const mockEq = vi.fn().mockReturnThis();
		const mockSingle = vi.fn().mockResolvedValue({
			data: null,
			error: { code: 'PGRST116' } // No existing record
		});

		const mockUpdate = vi.fn().mockReturnThis();
		const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from
			.mockReturnValueOnce({
				select: mockSelect,
				eq: mockEq,
				single: mockSingle
			} as any)
			.mockReturnValueOnce({
				update: mockUpdate,
				eq: mockEq2
			} as any);

		mockSelect.mockReturnValue({ eq: mockEq } as any);
		mockEq.mockReturnValue({ single: mockSingle } as any);
		mockUpdate.mockReturnValue({ eq: mockEq2 } as any);

		const response = await POST(event);
		expect(response.status).toBe(200);

		// T18: 再送時に正しい状態へ収束
		expect(mockUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'active',
				current_period_end: new Date(1675209600 * 1000).toISOString(),
				cancel_at_period_end: false
			})
		);
	});

	it('checkout.session.completedでsubscription取得が初回失敗しても再送時に成功すれば正しい状態に収束する（T18）', async () => {
		const request = createMockRequest('valid_signature', 'webhook_body');
		const event = { request } as RequestEvent;

		// First attempt: subscription.retrieve fails
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_test_456',
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_456',
					customer: 'cus_test_456',
					subscription: 'sub_test_456',
					metadata: {
						user_id: 'user_456',
						is_organization: 'false'
					}
				}
			}
		} as any);

		// T18: Stripe API一時障害をシミュレート
		vi.mocked(stripe.subscriptions.retrieve).mockRejectedValueOnce(
			new Error('Stripe connection error')
		);

		try {
			await POST(event);
			expect.fail('Expected RetryableError');
		} catch (err: any) {
			// T18: Stripe API失敗はRetryableError(500)で再送を促す
			expect(err.status).toBe(500);
			expect(err.body?.message).toContain('Stripe API');
		}

		// Second attempt: subscription.retrieve succeeds
		vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
			id: 'evt_test_456', // Same event ID (Stripe webhook retry)
			type: 'checkout.session.completed',
			data: {
				object: {
					id: 'cs_test_456',
					customer: 'cus_test_456',
					subscription: 'sub_test_456',
					metadata: {
						user_id: 'user_456',
						is_organization: 'false'
					}
				}
			}
		} as any);

		// T18: Stripe API回復
		vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
			id: 'sub_test_456',
			customer: 'cus_test_456',
			status: 'active',
			current_period_start: 1672531200,
			current_period_end: 1675209600,
			cancel_at_period_end: false,
			items: {
				data: [
					{
						price: {
							id: 'price_standard_month',
							recurring: { interval: 'month' }
						}
					}
				]
			}
		} as any);

		// Mock Supabase for successful processing
		const mockUpsert = vi.fn().mockResolvedValue({ data: null, error: null });

		mockSupabaseClient.from.mockReturnValueOnce({
			upsert: mockUpsert
		} as any);

		const response = await POST(event);
		expect(response.status).toBe(200);

		// T18: 再送時に正しい状態へ収束
		expect(mockUpsert).toHaveBeenCalledWith(
			expect.objectContaining({
				user_id: 'user_456',
				stripe_customer_id: 'cus_test_456',
				stripe_subscription_id: 'sub_test_456',
				plan_type: 'standard',
				status: 'active'
			}),
			{ onConflict: 'user_id' }
		);
	});
});
