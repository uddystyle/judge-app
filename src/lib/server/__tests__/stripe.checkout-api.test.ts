import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Use vi.hoisted to create mocks
const { mockSupabaseClient } = vi.hoisted(() => {
	return {
		mockSupabaseClient: {
			auth: {
				getUser: vi.fn()
			},
			from: vi.fn()
		}
	};
});

// Mock Stripe
vi.mock('$lib/server/stripe', () => ({
	stripe: {
		customers: {
			create: vi.fn()
		},
		checkout: {
			sessions: {
				create: vi.fn()
			}
		},
		billingPortal: {
			sessions: {
				create: vi.fn()
			}
		}
	}
}));

// Mock environment variables
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

// Import after mocks
import { POST as createCheckoutSession } from '../../../routes/api/stripe/create-checkout-session/+server';
import { POST as createOrganizationCheckout } from '../../../routes/api/stripe/create-organization-checkout/+server';
import { POST as upgradeOrganization } from '../../../routes/api/stripe/upgrade-organization/+server';
import { POST as customerPortal } from '../../../routes/api/stripe/customer-portal/+server';
import { POST as createPortalSession } from '../../../routes/api/stripe/create-portal-session/+server';
import { stripe } from '$lib/server/stripe';

describe('Checkout API認証・認可（P0-5）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const createMockRequest = (body: any) => {
		return {
			json: vi.fn().mockResolvedValue(body)
		} as unknown as Request;
	};

	describe('create-checkout-session', () => {
		it('未認証ユーザーは/loginにリダイレクトされる', async () => {
			const request = createMockRequest({
				priceId: 'price_basic_month',
				successUrl: 'http://localhost/success',
				cancelUrl: 'http://localhost/cancel'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			try {
				await createCheckoutSession(event);
				expect.fail('Expected redirect');
			} catch (err: any) {
				// SvelteKit redirect throws an object with status and location
				expect(err.status).toBe(303);
				expect(err.location).toBe('/login');
			}
		});

		it('必須パラメータ不足の場合は400を返す', async () => {
			const request = createMockRequest({
				// Missing priceId
				successUrl: 'http://localhost/success',
				cancelUrl: 'http://localhost/cancel'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			try {
				await createCheckoutSession(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(400);
				expect(err.body?.message).toContain('必須');
			}
		});
	});

	describe('create-organization-checkout', () => {
		it('未認証ユーザーは/loginにリダイレクトされる', async () => {
			const request = createMockRequest({
				organizationName: 'Test Org',
				planType: 'standard',
				billingInterval: 'month',
				returnUrl: 'http://localhost/success',
				cancelUrl: 'http://localhost/cancel'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			try {
				await createOrganizationCheckout(event);
				expect.fail('Expected redirect');
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toBe('/login');
			}
		});

		it('必須パラメータ不足の場合は400を返す', async () => {
			const request = createMockRequest({
				// Missing organizationName
				planType: 'standard',
				billingInterval: 'month',
				returnUrl: 'http://localhost/success',
				cancelUrl: 'http://localhost/cancel'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			try {
				await createOrganizationCheckout(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(400);
				expect(err.body?.message).toContain('必須');
			}
		});

		it('無効なplanTypeの場合は400を返す', async () => {
			const request = createMockRequest({
				organizationName: 'Test Org',
				planType: 'invalid_plan',
				billingInterval: 'month',
				returnUrl: 'http://localhost/success',
				cancelUrl: 'http://localhost/cancel'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			try {
				await createOrganizationCheckout(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(400);
				expect(err.body?.message).toContain('無効なプランタイプ');
			}
		});

		it('無効なbillingIntervalの場合は400を返す', async () => {
			const request = createMockRequest({
				organizationName: 'Test Org',
				planType: 'standard',
				billingInterval: 'invalid_interval',
				returnUrl: 'http://localhost/success',
				cancelUrl: 'http://localhost/cancel'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			try {
				await createOrganizationCheckout(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(400);
				expect(err.body?.message).toContain('無効な請求間隔');
			}
		});
	});

	describe('upgrade-organization', () => {
		it('未認証ユーザーは401を返す', async () => {
			const request = createMockRequest({
				organizationId: 'org_123',
				planType: 'premium',
				billingInterval: 'year',
				returnUrl: 'http://localhost/success',
				cancelUrl: 'http://localhost/cancel'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			try {
				await upgradeOrganization(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(401);
				expect(err.body?.message).toContain('認証');
			}
		});

		it('admin権限がない場合は403を返す', async () => {
			const request = createMockRequest({
				organizationId: 'org_123',
				planType: 'premium',
				billingInterval: 'year',
				returnUrl: 'http://localhost/success',
				cancelUrl: 'http://localhost/cancel'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// Mock organization exists
			const mockSelect1 = vi.fn().mockReturnThis();
			const mockEq1 = vi.fn().mockReturnThis();
			const mockSingle1 = vi.fn().mockResolvedValue({
				data: { id: 'org_123', name: 'Test Org' },
				error: null
			});

			// Mock user is not admin
			const mockSelect2 = vi.fn().mockReturnThis();
			const mockEq2a = vi.fn().mockReturnThis();
			const mockEq2b = vi.fn().mockReturnThis();
			const mockSingle2 = vi.fn().mockResolvedValue({
				data: { role: 'member' }, // Not admin
				error: null
			});

			mockSupabaseClient.from
				.mockReturnValueOnce({
					select: mockSelect1,
					eq: mockEq1,
					single: mockSingle1
				} as any)
				.mockReturnValueOnce({
					select: mockSelect2,
					eq: mockEq2a,
					single: mockSingle2
				} as any);

			mockSelect1.mockReturnValue({
				eq: mockEq1
			} as any);

			mockEq1.mockReturnValue({
				single: mockSingle1
			} as any);

			mockSelect2.mockReturnValue({
				eq: mockEq2a
			} as any);

			mockEq2a.mockReturnValue({
				eq: mockEq2b
			} as any);

			mockEq2b.mockReturnValue({
				single: mockSingle2
			} as any);

			try {
				await upgradeOrganization(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(403);
				expect(err.body?.message).toContain('管理者権限');
			}
		});

		it('必須パラメータ不足の場合は400を返す', async () => {
			const request = createMockRequest({
				// Missing organizationId
				planType: 'premium',
				billingInterval: 'year',
				returnUrl: 'http://localhost/success',
				cancelUrl: 'http://localhost/cancel'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			try {
				await upgradeOrganization(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(400);
				expect(err.body?.message).toContain('必須');
			}
		});

		it('無効なplanTypeの場合は400を返す', async () => {
			const request = createMockRequest({
				organizationId: 'org_123',
				planType: 'invalid_plan',
				billingInterval: 'year',
				returnUrl: 'http://localhost/success',
				cancelUrl: 'http://localhost/cancel'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			try {
				await upgradeOrganization(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(400);
				expect(err.body?.message).toContain('プランタイプ');
			}
		});

		it('無効なbillingIntervalの場合は400を返す', async () => {
			const request = createMockRequest({
				organizationId: 'org_123',
				planType: 'premium',
				billingInterval: 'invalid_interval',
				returnUrl: 'http://localhost/success',
				cancelUrl: 'http://localhost/cancel'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			try {
				await upgradeOrganization(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(400);
				expect(err.body?.message).toContain('請求間隔');
			}
		});
	});
});

describe('Customer Portal API（P2-1）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const createMockRequest = (body: any) => {
		return {
			json: vi.fn().mockResolvedValue(body)
		} as unknown as Request;
	};

	describe('customer-portal', () => {
		it('未認証ユーザーは401を返す', async () => {
			const request = createMockRequest({
				returnUrl: 'http://localhost/settings',
				organizationId: 'org_123'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			try {
				await customerPortal(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(401);
				expect(err.body?.message).toContain('認証');
			}
		});

		it('必須パラメータ不足の場合は400を返す', async () => {
			const request = createMockRequest({
				// Missing organizationId
				returnUrl: 'http://localhost/settings'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			try {
				await customerPortal(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(400);
				expect(err.body?.message).toContain('必須');
			}
		});

		it('組織またはstripe_customer_idが見つからない場合は404を返す', async () => {
			const request = createMockRequest({
				returnUrl: 'http://localhost/settings',
				organizationId: 'org_123'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// Mock organization not found
			const mockSelect = vi.fn().mockReturnThis();
			const mockEq = vi.fn().mockReturnThis();
			const mockSingle = vi.fn().mockResolvedValue({
				data: null,
				error: { code: 'PGRST116' }
			});

			mockSupabaseClient.from.mockReturnValue({
				select: mockSelect,
				eq: mockEq,
				single: mockSingle
			} as any);

			try {
				await customerPortal(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(404);
				expect(err.body?.message).toContain('組織');
			}
		});

		it('他組織IDでアクセスした場合は403を返す（メンバーシップなし）', async () => {
			const request = createMockRequest({
				returnUrl: 'http://localhost/settings',
				organizationId: 'org_other_456'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// Mock organization found with stripe_customer_id (first from() call)
			const mockSelect1 = vi.fn().mockReturnThis();
			const mockEq1 = vi.fn().mockReturnThis();
			const mockSingle1 = vi.fn().mockResolvedValue({
				data: { stripe_customer_id: 'cus_other_456' },
				error: null
			});

			// Mock organization_members not found (second from() call)
			const mockSelect2 = vi.fn().mockReturnThis();
			const mockEq2 = vi.fn().mockReturnThis();
			const mockSingle2 = vi.fn().mockResolvedValue({
				data: null,
				error: { code: 'PGRST116' }
			});

			mockSupabaseClient.from
				.mockReturnValueOnce({
					select: mockSelect1,
					eq: mockEq1,
					single: mockSingle1
				} as any)
				.mockReturnValueOnce({
					select: mockSelect2,
					eq: mockEq2,
					single: mockSingle2
				} as any);

			try {
				await customerPortal(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(403);
				expect(err.body?.message).toContain('管理者権限');
			}
		});

		it('管理者でないメンバーの場合は403を返す', async () => {
			const request = createMockRequest({
				returnUrl: 'http://localhost/settings',
				organizationId: 'org_123'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// Mock organization found with stripe_customer_id (first from() call)
			const mockSelect1 = vi.fn().mockReturnThis();
			const mockEq1 = vi.fn().mockReturnThis();
			const mockSingle1 = vi.fn().mockResolvedValue({
				data: { stripe_customer_id: 'cus_test_123' },
				error: null
			});

			// Mock organization_members with member role (not admin) (second from() call)
			const mockSelect2 = vi.fn().mockReturnThis();
			const mockEq2 = vi.fn().mockReturnThis();
			const mockSingle2 = vi.fn().mockResolvedValue({
				data: { role: 'member' },
				error: null
			});

			mockSupabaseClient.from
				.mockReturnValueOnce({
					select: mockSelect1,
					eq: mockEq1,
					single: mockSingle1
				} as any)
				.mockReturnValueOnce({
					select: mockSelect2,
					eq: mockEq2,
					single: mockSingle2
				} as any);

			try {
				await customerPortal(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(403);
				expect(err.body?.message).toContain('管理者権限');
			}
		});

		it('正常系: Customer Portalセッションが作成される', async () => {
			const request = createMockRequest({
				returnUrl: 'http://localhost/settings',
				organizationId: 'org_123'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// Mock organization with stripe_customer_id (first from() call)
			const mockSelect1 = vi.fn().mockReturnThis();
			const mockEq1 = vi.fn().mockReturnThis();
			const mockSingle1 = vi.fn().mockResolvedValue({
				data: { stripe_customer_id: 'cus_test_123' },
				error: null
			});

			// Mock organization_members with admin role (second from() call)
			const mockSelect2 = vi.fn().mockReturnThis();
			const mockEq2 = vi.fn().mockReturnThis();
			const mockSingle2 = vi.fn().mockResolvedValue({
				data: { role: 'admin' },
				error: null
			});

			mockSupabaseClient.from
				.mockReturnValueOnce({
					select: mockSelect1,
					eq: mockEq1,
					single: mockSingle1
				} as any)
				.mockReturnValueOnce({
					select: mockSelect2,
					eq: mockEq2,
					single: mockSingle2
				} as any);

			// Mock Stripe billingPortal.sessions.create
			vi.mocked(stripe.billingPortal.sessions.create).mockResolvedValue({
				id: 'bps_test_123',
				url: 'https://billing.stripe.com/session/test_123'
			} as any);

			const response = await customerPortal(event);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.url).toBe('https://billing.stripe.com/session/test_123');
			expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
				customer: 'cus_test_123',
				return_url: 'http://localhost/settings'
			});
		});

		// T21: Portal API認可境界の追加テスト
		it('退会済みメンバー（removed_at IS NOT NULL）の場合は403を返す（T21）', async () => {
			const request = createMockRequest({
				returnUrl: 'http://localhost/settings',
				organizationId: 'org_123'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// Mock organization found with stripe_customer_id (first from() call)
			const mockSelect1 = vi.fn().mockReturnThis();
			const mockEq1 = vi.fn().mockReturnThis();
			const mockSingle1 = vi.fn().mockResolvedValue({
				data: { stripe_customer_id: 'cus_test_123' },
				error: null
			});

			// T21: Mock organization_members query returns null (RLS filters out removed member)
			// When removed_at IS NOT NULL, RLS policy prevents SELECT
			const mockSelect2 = vi.fn().mockReturnThis();
			const mockEq2 = vi.fn().mockReturnThis();
			const mockSingle2 = vi.fn().mockResolvedValue({
				data: null,
				error: { code: 'PGRST116', message: 'No rows found' }
			});

			mockSupabaseClient.from
				.mockReturnValueOnce({
					select: mockSelect1,
					eq: mockEq1,
					single: mockSingle1
				} as any)
				.mockReturnValueOnce({
					select: mockSelect2,
					eq: mockEq2,
					single: mockSingle2
				} as any);

			try {
				await customerPortal(event);
				expect.fail('Expected error');
			} catch (err: any) {
				// T21: 退会済みメンバーはアクセス拒否（403）
				expect(err.status).toBe(403);
				expect(err.body?.message).toContain('管理者権限');
			}
		});
	});

	describe('create-portal-session', () => {
		it('未認証ユーザーは/loginにリダイレクトされる', async () => {
			const request = createMockRequest({
				returnUrl: 'http://localhost/settings'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			try {
				await createPortalSession(event);
				expect.fail('Expected redirect');
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toBe('/login');
			}
		});

		it('必須パラメータ不足の場合は400を返す', async () => {
			const request = createMockRequest({
				// Missing returnUrl
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			try {
				await createPortalSession(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(400);
				expect(err.body?.message).toContain('returnUrl');
			}
		});

		it('サブスクリプション情報が見つからない場合は404を返す', async () => {
			const request = createMockRequest({
				returnUrl: 'http://localhost/settings'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// Mock subscription not found
			const mockSelect = vi.fn().mockReturnThis();
			const mockEq = vi.fn().mockReturnThis();
			const mockIs = vi.fn().mockReturnThis();
			const mockSingle = vi.fn().mockResolvedValue({
				data: null,
				error: { code: 'PGRST116' }
			});

			mockSupabaseClient.from.mockReturnValue({
				select: mockSelect,
				eq: mockEq,
				is: mockIs,
				single: mockSingle
			} as any);

			try {
				await createPortalSession(event);
				expect.fail('Expected error');
			} catch (err: any) {
				expect(err.status).toBe(404);
				expect(err.body?.message).toContain('サブスクリプション');
			}
		});

		it('正常系: Portal Sessionが作成される', async () => {
			const request = createMockRequest({
				returnUrl: 'http://localhost/settings'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// Mock subscription with stripe_customer_id
			const mockSelect = vi.fn().mockReturnThis();
			const mockEq = vi.fn().mockReturnThis();
			const mockIs = vi.fn().mockReturnThis();
			const mockSingle = vi.fn().mockResolvedValue({
				data: { stripe_customer_id: 'cus_test_123' },
				error: null
			});

			mockSupabaseClient.from.mockReturnValue({
				select: mockSelect,
				eq: mockEq,
				is: mockIs,
				single: mockSingle
			} as any);

			// Mock Stripe billingPortal.sessions.create
			vi.mocked(stripe.billingPortal.sessions.create).mockResolvedValue({
				id: 'bps_test_123',
				url: 'https://billing.stripe.com/session/test_123'
			} as any);

			const response = await createPortalSession(event);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.url).toBe('https://billing.stripe.com/session/test_123');
			expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
				customer: 'cus_test_123',
				return_url: 'http://localhost/settings'
			});
		});

		// T21: Portal API認可境界の追加テスト
		it('個人プランがなく組織プランのみのユーザーの場合は404を返す（T21）', async () => {
			const request = createMockRequest({
				returnUrl: 'http://localhost/settings'
			});
			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// T21: Mock subscription query returns null
			// User has organization subscription but no personal subscription
			// Query filters organization_id IS NULL, so returns no results
			const mockSelect = vi.fn().mockReturnThis();
			const mockEq = vi.fn().mockReturnThis();
			const mockIs = vi.fn().mockReturnThis();
			const mockSingle = vi.fn().mockResolvedValue({
				data: null,
				error: { code: 'PGRST116', message: 'No rows found' }
			});

			mockSupabaseClient.from.mockReturnValue({
				select: mockSelect,
				eq: mockEq,
				is: mockIs,
				single: mockSingle
			} as any);

			try {
				await createPortalSession(event);
				expect.fail('Expected error');
			} catch (err: any) {
				// T21: 個人プラン未契約のユーザーはPortalアクセス不可（404）
				expect(err.status).toBe(404);
				expect(err.body?.message).toContain('サブスクリプション');
			}
		});
	});
});

describe('Stripe API障害時の応答統一（T3）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('create-portal-session APIのStripe障害処理（T3）', () => {
		it('Stripe billingPortal APIが失敗した場合は500を返す（T3）', async () => {
			// Mock successful auth
			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// Mock successful subscription fetch
			const mockSelect = vi.fn().mockReturnThis();
			const mockEq1 = vi.fn().mockReturnThis();
			const mockEq2 = vi.fn().mockReturnThis();
			const mockIsNull = vi.fn().mockReturnThis();
			const mockSingle = vi.fn().mockResolvedValue({
				data: { stripe_customer_id: 'cus_test_123' },
				error: null
			});

			mockSupabaseClient.from.mockReturnValue({
				select: mockSelect
			} as any);

			mockSelect.mockReturnValue({ eq: mockEq1 } as any);
			mockEq1.mockReturnValue({ is: mockIsNull } as any);
			mockIsNull.mockReturnValue({ single: mockSingle } as any);

			// Mock Stripe API failure
			(stripe.billingPortal.sessions.create as any).mockRejectedValue(
				new Error('Stripe API is temporarily unavailable')
			);

			const event = {
				request: new Request('http://localhost/api/stripe/create-portal-session', {
					method: 'POST',
					body: JSON.stringify({
						returnUrl: 'http://localhost/settings'
					})
				}),
				locals: { supabase: mockSupabaseClient }
			} as any;

			try {
				await createPortalSession(event);
				expect.fail('Expected error to be thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
				expect(err.body?.message).toContain('Stripe API is temporarily unavailable');
			}
		});
	});

	describe('customer-portal APIのStripe障害処理（T3）', () => {
		it('Stripe billingPortal APIが失敗した場合は500を返す（T3）', async () => {
			// Mock successful auth
			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// Mock successful organization fetch
			const mockSelect1 = vi.fn().mockReturnThis();
			const mockEq1 = vi.fn().mockReturnThis();
			const mockSingle1 = vi.fn().mockResolvedValue({
				data: { stripe_customer_id: 'cus_org_123' },
				error: null
			});

			// Mock successful member fetch (admin)
			const mockSelect2 = vi.fn().mockReturnThis();
			const mockEq2 = vi.fn().mockReturnThis();
			const mockEq3 = vi.fn().mockReturnThis();
			const mockSingle2 = vi.fn().mockResolvedValue({
				data: { role: 'admin' },
				error: null
			});

			mockSupabaseClient.from
				.mockReturnValueOnce({
					select: mockSelect1
				} as any)
				.mockReturnValueOnce({
					select: mockSelect2
				} as any);

			mockSelect1.mockReturnValue({ eq: mockEq1 } as any);
			mockEq1.mockReturnValue({ single: mockSingle1 } as any);

			mockSelect2.mockReturnValue({ eq: mockEq2 } as any);
			mockEq2.mockReturnValue({ eq: mockEq3 } as any);
			mockEq3.mockReturnValue({ single: mockSingle2 } as any);

			// Mock Stripe API failure
			(stripe.billingPortal.sessions.create as any).mockRejectedValue(
				new Error('Stripe service unavailable')
			);

			const event = {
				request: new Request('http://localhost/api/stripe/customer-portal', {
					method: 'POST',
					body: JSON.stringify({
						organizationId: 'org_123',
						returnUrl: 'http://localhost/settings'
					})
				}),
				locals: { supabase: mockSupabaseClient }
			} as any;

			// T3: customer-portalはerror(500)をthrowする（統一された応答形式）
			try {
				await customerPortal(event);
				expect.fail('Expected error to be thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
				expect(err.body?.message).toContain('Stripe service unavailable');
			}
		});
	});

	// ============================================================
	// T12: Portal APIのStripeエラー種別テスト
	// ============================================================

	describe('create-portal-session: Stripeエラー種別ごとの処理（T12）', () => {
		const setupSuccessfulMocks = () => {
			// Mock successful auth
			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// Mock successful subscription fetch
			const mockSelect = vi.fn().mockReturnThis();
			const mockEq1 = vi.fn().mockReturnThis();
			const mockIs = vi.fn().mockReturnThis();
			const mockSingle = vi.fn().mockResolvedValue({
				data: { stripe_customer_id: 'cus_test_123' },
				error: null
			});

			mockSupabaseClient.from.mockReturnValue({
				select: mockSelect,
				eq: mockEq1,
				is: mockIs,
				single: mockSingle
			} as any);
		};

		it('StripeのRate Limit Error (429)を500として返す（T12）', async () => {
			setupSuccessfulMocks();

			// Mock Stripe rate limit error
			const rateLimitError = new Error('Rate limit exceeded');
			(rateLimitError as any).type = 'StripeRateLimitError';
			(rateLimitError as any).statusCode = 429;
			vi.mocked(stripe.billingPortal.sessions.create).mockRejectedValue(rateLimitError);

			const event = {
				request: new Request('http://localhost/api/stripe/create-portal-session', {
					method: 'POST',
					body: JSON.stringify({
						returnUrl: 'http://localhost/settings'
					})
				}),
				locals: { supabase: mockSupabaseClient }
			} as any;

			try {
				await createPortalSession(event);
				expect.fail('Expected error to be thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
				expect(err.body?.message).toContain('Rate limit exceeded');
			}
		});

		it('StripeのAPI Connection Error (タイムアウト)を500として返す（T12）', async () => {
			setupSuccessfulMocks();

			// Mock Stripe connection error
			const connectionError = new Error('Network connection timeout');
			(connectionError as any).type = 'StripeConnectionError';
			vi.mocked(stripe.billingPortal.sessions.create).mockRejectedValue(connectionError);

			const event = {
				request: new Request('http://localhost/api/stripe/create-portal-session', {
					method: 'POST',
					body: JSON.stringify({
						returnUrl: 'http://localhost/settings'
					})
				}),
				locals: { supabase: mockSupabaseClient }
			} as any;

			try {
				await createPortalSession(event);
				expect.fail('Expected error to be thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
				expect(err.body?.message).toContain('Network connection timeout');
			}
		});

		it('StripeのInvalid Request Error (無効なcustomer ID)を500として返す（T12）', async () => {
			setupSuccessfulMocks();

			// Mock Stripe invalid request error
			const invalidError = new Error('No such customer: cus_invalid');
			(invalidError as any).type = 'StripeInvalidRequestError';
			(invalidError as any).statusCode = 404;
			vi.mocked(stripe.billingPortal.sessions.create).mockRejectedValue(invalidError);

			const event = {
				request: new Request('http://localhost/api/stripe/create-portal-session', {
					method: 'POST',
					body: JSON.stringify({
						returnUrl: 'http://localhost/settings'
					})
				}),
				locals: { supabase: mockSupabaseClient }
			} as any;

			try {
				await createPortalSession(event);
				expect.fail('Expected error to be thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
				expect(err.body?.message).toContain('No such customer');
			}
		});

		it('StripeのAPI Error (Stripe側障害)を500として返す（T12）', async () => {
			setupSuccessfulMocks();

			// Mock Stripe API error
			const apiError = new Error('An error occurred with our API');
			(apiError as any).type = 'StripeAPIError';
			vi.mocked(stripe.billingPortal.sessions.create).mockRejectedValue(apiError);

			const event = {
				request: new Request('http://localhost/api/stripe/create-portal-session', {
					method: 'POST',
					body: JSON.stringify({
						returnUrl: 'http://localhost/settings'
					})
				}),
				locals: { supabase: mockSupabaseClient }
			} as any;

			try {
				await createPortalSession(event);
				expect.fail('Expected error to be thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
				expect(err.body?.message).toContain('An error occurred with our API');
			}
		});
	});

	describe('customer-portal: Stripeエラー種別ごとの処理（T12）', () => {
		const setupSuccessfulMocks = () => {
			// Mock successful auth
			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user_123', email: 'test@example.com' } },
				error: null
			});

			// Mock successful organization fetch
			const mockSelect1 = vi.fn().mockReturnThis();
			const mockEq1 = vi.fn().mockReturnThis();
			const mockSingle1 = vi.fn().mockResolvedValue({
				data: { stripe_customer_id: 'cus_org_123' },
				error: null
			});

			// Mock successful member role fetch
			const mockSelect2 = vi.fn().mockReturnThis();
			const mockEq2a = vi.fn().mockReturnThis();
			const mockEq2b = vi.fn().mockReturnThis();
			const mockSingle2 = vi.fn().mockResolvedValue({
				data: { role: 'admin' },
				error: null
			});

			mockSupabaseClient.from
				.mockReturnValueOnce({
					select: mockSelect1,
					eq: mockEq1,
					single: mockSingle1
				} as any)
				.mockReturnValueOnce({
					select: mockSelect2,
					eq: mockEq2a
				} as any);

			mockEq2a.mockReturnValue({
				eq: mockEq2b,
				single: mockSingle2
			} as any);
		};

		it('StripeのRate Limit Error (429)を500として返す（T12）', async () => {
			setupSuccessfulMocks();

			// Mock Stripe rate limit error
			const rateLimitError = new Error('Rate limit exceeded');
			(rateLimitError as any).type = 'StripeRateLimitError';
			(rateLimitError as any).statusCode = 429;
			vi.mocked(stripe.billingPortal.sessions.create).mockRejectedValue(rateLimitError);

			const event = {
				request: new Request('http://localhost/api/stripe/customer-portal', {
					method: 'POST',
					body: JSON.stringify({
						organizationId: 'org_123',
						returnUrl: 'http://localhost/settings'
					})
				}),
				locals: { supabase: mockSupabaseClient }
			} as any;

			try {
				await customerPortal(event);
				expect.fail('Expected error to be thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
				expect(err.body?.message).toContain('Rate limit exceeded');
			}
		});

		it('StripeのAPI Connection Error (タイムアウト)を500として返す（T12）', async () => {
			setupSuccessfulMocks();

			// Mock Stripe connection error
			const connectionError = new Error('Network connection timeout');
			(connectionError as any).type = 'StripeConnectionError';
			vi.mocked(stripe.billingPortal.sessions.create).mockRejectedValue(connectionError);

			const event = {
				request: new Request('http://localhost/api/stripe/customer-portal', {
					method: 'POST',
					body: JSON.stringify({
						organizationId: 'org_123',
						returnUrl: 'http://localhost/settings'
					})
				}),
				locals: { supabase: mockSupabaseClient }
			} as any;

			try {
				await customerPortal(event);
				expect.fail('Expected error to be thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
				expect(err.body?.message).toContain('Network connection timeout');
			}
		});

		it('StripeのInvalid Request Error (無効なcustomer ID)を500として返す（T12）', async () => {
			setupSuccessfulMocks();

			// Mock Stripe invalid request error
			const invalidError = new Error('No such customer: cus_invalid');
			(invalidError as any).type = 'StripeInvalidRequestError';
			(invalidError as any).statusCode = 404;
			vi.mocked(stripe.billingPortal.sessions.create).mockRejectedValue(invalidError);

			const event = {
				request: new Request('http://localhost/api/stripe/customer-portal', {
					method: 'POST',
					body: JSON.stringify({
						organizationId: 'org_123',
						returnUrl: 'http://localhost/settings'
					})
				}),
				locals: { supabase: mockSupabaseClient }
			} as any;

			try {
				await customerPortal(event);
				expect.fail('Expected error to be thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
				expect(err.body?.message).toContain('No such customer');
			}
		});

		it('StripeのAPI Error (Stripe側障害)を500として返す（T12）', async () => {
			setupSuccessfulMocks();

			// Mock Stripe API error
			const apiError = new Error('An error occurred with our API');
			(apiError as any).type = 'StripeAPIError';
			vi.mocked(stripe.billingPortal.sessions.create).mockRejectedValue(apiError);

			const event = {
				request: new Request('http://localhost/api/stripe/customer-portal', {
					method: 'POST',
					body: JSON.stringify({
						organizationId: 'org_123',
						returnUrl: 'http://localhost/settings'
					})
				}),
				locals: { supabase: mockSupabaseClient }
			} as any;

			try {
				await customerPortal(event);
				expect.fail('Expected error to be thrown');
			} catch (err: any) {
				expect(err.status).toBe(500);
				expect(err.body?.message).toContain('An error occurred with our API');
			}
		});
	});
});
