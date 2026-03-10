import { describe, test, expect, beforeEach, vi } from 'vitest';
import { validateRedirectUrl, ALLOWED_STRIPE_REDIRECT_PATHS } from '../validation';

// Mock PUBLIC_SITE_URL for testing
vi.mock('$env/static/public', () => ({
	PUBLIC_SITE_URL: 'http://localhost:5173'
}));

describe('validateRedirectUrl', () => {
	describe('Valid cases - Relative paths', () => {
		test('accepts valid relative path /dashboard', () => {
			const result = validateRedirectUrl('/dashboard', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe('http://localhost:5173/dashboard');
		});

		test('accepts valid relative path /account', () => {
			const result = validateRedirectUrl('/account', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe('http://localhost:5173/account');
		});

		test('accepts valid relative path /pricing', () => {
			const result = validateRedirectUrl('/pricing', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe('http://localhost:5173/pricing');
		});

		test('accepts valid relative path /organizations', () => {
			const result = validateRedirectUrl('/organizations', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe('http://localhost:5173/organizations');
		});
	});

	describe('Valid cases - Organization UUID paths', () => {
		test('accepts organization UUID path', () => {
			const result = validateRedirectUrl(
				'/organization/550e8400-e29b-41d4-a716-446655440000',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe(
				'http://localhost:5173/organization/550e8400-e29b-41d4-a716-446655440000'
			);
		});

		test('accepts organization upgrade path', () => {
			const result = validateRedirectUrl(
				'/organization/550e8400-e29b-41d4-a716-446655440000/upgrade',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe(
				'http://localhost:5173/organization/550e8400-e29b-41d4-a716-446655440000/upgrade'
			);
		});

		test('rejects organization path with invalid UUID format', () => {
			const result = validateRedirectUrl(
				'/organization/invalid-uuid',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Path not allowed');
		});

		test('rejects organization path with UUID v3 (not v4)', () => {
			// UUID v3 has '3' in the version position instead of '4'
			const result = validateRedirectUrl(
				'/organization/550e8400-e29b-31d4-a716-446655440000',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Path not allowed');
		});
	});

	describe('Valid cases - Same-origin URLs', () => {
		test('accepts same-origin URL with localhost', () => {
			const result = validateRedirectUrl(
				'http://localhost:5173/dashboard',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe('http://localhost:5173/dashboard');
		});

		test('accepts localhost with different port (dev environment)', () => {
			const result = validateRedirectUrl(
				'http://localhost:3000/dashboard',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe('http://localhost:5173/dashboard');
		});

		test('accepts localhost with different port and allowed path', () => {
			const result = validateRedirectUrl(
				'http://localhost:8080/account',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe('http://localhost:5173/account');
		});
	});

	describe('Valid cases - Query parameters and hash fragments', () => {
		test('preserves query parameters', () => {
			const result = validateRedirectUrl(
				'/dashboard?success=true',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe('http://localhost:5173/dashboard?success=true');
		});

		test('preserves multiple query parameters', () => {
			const result = validateRedirectUrl(
				'/dashboard?success=true&sessionId=abc123',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe(
				'http://localhost:5173/dashboard?success=true&sessionId=abc123'
			);
		});

		test('preserves hash fragments', () => {
			const result = validateRedirectUrl('/account#settings', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe('http://localhost:5173/account#settings');
		});

		test('preserves both query parameters and hash fragments', () => {
			const result = validateRedirectUrl(
				'/account?tab=billing#subscription',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe('http://localhost:5173/account?tab=billing#subscription');
		});
	});

	describe('Valid cases - Trailing slashes', () => {
		test('normalizes trailing slash', () => {
			const result = validateRedirectUrl('/dashboard/', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe('http://localhost:5173/dashboard');
		});

		test('does not remove trailing slash from root path', () => {
			// Root path '/' should not be in allowed paths for Stripe redirects
			const result = validateRedirectUrl('/', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
		});
	});

	describe('Invalid cases - External domains', () => {
		test('rejects external domain', () => {
			const result = validateRedirectUrl(
				'https://evil.com/dashboard',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Origin mismatch');
		});

		test('rejects attacker domain with same path', () => {
			const result = validateRedirectUrl(
				'https://attacker.com/dashboard',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Origin mismatch');
		});

		test('rejects subdomain attack', () => {
			const result = validateRedirectUrl(
				'http://evil.localhost:5173/dashboard',
				ALLOWED_STRIPE_REDIRECT_PATHS
			);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Origin mismatch');
		});
	});

	describe('Invalid cases - Non-allowed paths', () => {
		test('rejects /admin path', () => {
			const result = validateRedirectUrl('/admin', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Path not allowed');
		});

		test('rejects /api/secrets path', () => {
			const result = validateRedirectUrl('/api/secrets', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Path not allowed');
		});

		test('rejects arbitrary path', () => {
			const result = validateRedirectUrl('/some/random/path', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Path not allowed');
		});

		test('rejects root path', () => {
			const result = validateRedirectUrl('/', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Path not allowed');
		});
	});

	describe('Invalid cases - Protocol attacks', () => {
		test('rejects javascript: protocol', () => {
			const result = validateRedirectUrl('javascript:alert(1)', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Origin mismatch');
		});

		test('rejects data: protocol', () => {
			const result = validateRedirectUrl('data:text/html,<script>alert(1)</script>', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Origin mismatch');
		});

		test('rejects file: protocol', () => {
			const result = validateRedirectUrl('file:///etc/passwd', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Origin mismatch');
		});
	});

	describe('Invalid cases - Empty/null inputs', () => {
		test('rejects empty string', () => {
			const result = validateRedirectUrl('', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toBe('URL is required');
		});

		test('rejects null', () => {
			const result = validateRedirectUrl(null, ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toBe('URL is required');
		});

		test('rejects undefined', () => {
			const result = validateRedirectUrl(undefined, ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toBe('URL is required');
		});

		test('rejects whitespace-only string', () => {
			const result = validateRedirectUrl('   ', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toBe('URL is required');
		});
	});

	describe('Invalid cases - Malformed URLs', () => {
		test('rejects URL with spaces', () => {
			const result = validateRedirectUrl('http://localhost:5173/dash board', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('Path not allowed');
		});

		test('rejects malformed URL', () => {
			const result = validateRedirectUrl('ht!tp://invalid', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(false);
			expect(result.error).toBe('Invalid URL format');
		});
	});

	describe('Edge cases', () => {
		test('trims whitespace from input', () => {
			const result = validateRedirectUrl('  /dashboard  ', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toBe('http://localhost:5173/dashboard');
		});

		test('handles URL with encoded characters', () => {
			const result = validateRedirectUrl('/dashboard?redirect=%2Faccount', ALLOWED_STRIPE_REDIRECT_PATHS);
			expect(result.valid).toBe(true);
			expect(result.sanitizedUrl).toContain('redirect=%2Faccount');
		});
	});

	describe('ALLOWED_STRIPE_REDIRECT_PATHS constant', () => {
		test('contains expected string paths', () => {
			expect(ALLOWED_STRIPE_REDIRECT_PATHS).toContain('/dashboard');
			expect(ALLOWED_STRIPE_REDIRECT_PATHS).toContain('/account');
			expect(ALLOWED_STRIPE_REDIRECT_PATHS).toContain('/pricing');
			expect(ALLOWED_STRIPE_REDIRECT_PATHS).toContain('/organizations');
		});

		test('contains regex patterns for organization paths', () => {
			const regexPatterns = ALLOWED_STRIPE_REDIRECT_PATHS.filter((p) => p instanceof RegExp);
			expect(regexPatterns.length).toBeGreaterThan(0);
		});
	});
});
