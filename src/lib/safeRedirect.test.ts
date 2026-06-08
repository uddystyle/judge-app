import { describe, it, expect } from 'vitest';
import { isSafeRedirectPath, getSafeRedirectPath } from './safeRedirect';

describe('isSafeRedirectPath', () => {
	it('null や undefined や 空文字 は false', () => {
		expect(isSafeRedirectPath(null)).toBe(false);
		expect(isSafeRedirectPath(undefined)).toBe(false);
		expect(isSafeRedirectPath('')).toBe(false);
	});

	it('許可された固定パスは true', () => {
		expect(isSafeRedirectPath('/dashboard')).toBe(true);
		expect(isSafeRedirectPath('/onboarding/create-organization')).toBe(true);
		expect(isSafeRedirectPath('/account')).toBe(true);
		expect(isSafeRedirectPath('/reset-password/confirm')).toBe(true);
	});

	it('UUID v4 形式の組織パスは true', () => {
		expect(
			isSafeRedirectPath('/organization/12345678-1234-4abc-89ab-1234567890ab')
		).toBe(true);
	});

	it('UUID v4 でない組織パスは false', () => {
		// バージョン部分が 4 でない
		expect(
			isSafeRedirectPath('/organization/12345678-1234-1abc-89ab-1234567890ab')
		).toBe(false);
		// バリアント部分が 8/9/a/b でない
		expect(
			isSafeRedirectPath('/organization/12345678-1234-4abc-c9ab-1234567890ab')
		).toBe(false);
		// 短い
		expect(isSafeRedirectPath('/organization/abc')).toBe(false);
	});

	it('招待完了パスは true', () => {
		expect(isSafeRedirectPath('/invite/abc123-token/complete')).toBe(true);
		expect(isSafeRedirectPath('/invite/A-Z-0-9/complete')).toBe(true);
	});

	it('招待トークンに記号が含まれる場合は false', () => {
		expect(isSafeRedirectPath('/invite/abc.123/complete')).toBe(false);
		expect(isSafeRedirectPath('/invite/abc/123/complete')).toBe(false);
	});

	it('プロトコル相対 URL は false（オープンリダイレクト防止）', () => {
		expect(isSafeRedirectPath('//evil.example.com')).toBe(false);
		expect(isSafeRedirectPath('//evil.example.com/dashboard')).toBe(false);
		expect(isSafeRedirectPath('/\\evil.example.com')).toBe(false);
	});

	it('絶対 URL は false', () => {
		expect(isSafeRedirectPath('https://evil.example.com')).toBe(false);
		expect(isSafeRedirectPath('http://evil.example.com')).toBe(false);
	});

	it('未登録のパスは false', () => {
		expect(isSafeRedirectPath('/admin')).toBe(false);
		expect(isSafeRedirectPath('/some/random/path')).toBe(false);
	});

	it('スキーム付きの相対参照は false', () => {
		expect(isSafeRedirectPath('javascript:alert(1)')).toBe(false);
		expect(isSafeRedirectPath('data:text/html,foo')).toBe(false);
	});
});

describe('getSafeRedirectPath', () => {
	it('安全な next はそのまま返す', () => {
		expect(getSafeRedirectPath('/dashboard', '/fallback')).toBe('/dashboard');
		expect(
			getSafeRedirectPath('/invite/abc/complete', '/fallback')
		).toBe('/invite/abc/complete');
	});

	it('未指定や危険な next はフォールバックを返す', () => {
		expect(getSafeRedirectPath(null, '/dashboard')).toBe('/dashboard');
		expect(getSafeRedirectPath(undefined, '/dashboard')).toBe('/dashboard');
		expect(getSafeRedirectPath('//evil.example.com', '/dashboard')).toBe(
			'/dashboard'
		);
		expect(
			getSafeRedirectPath('https://evil.example.com', '/dashboard')
		).toBe('/dashboard');
		expect(getSafeRedirectPath('/random/path', '/dashboard')).toBe('/dashboard');
	});
});
