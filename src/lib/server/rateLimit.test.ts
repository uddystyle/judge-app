import { describe, it, expect } from 'vitest';
import { getClientIdentifier } from './rateLimit';

/**
 * getClientIdentifier のクライアントIP導出テスト（詐称耐性）
 *
 * Vercel では x-forwarded-for の左端はクライアントが prepend できるため詐称可能。
 * Vercel が設定する x-real-ip / x-forwarded-for の右端ホップ（実接続元IP）を使う。
 */
function reqWith(headers: Record<string, string>): Request {
	return new Request('https://example.com/api', { headers });
}

describe('getClientIdentifier', () => {
	it('userId があれば user:<id> を最優先', () => {
		const req = reqWith({ 'x-forwarded-for': '1.2.3.4' });
		expect(getClientIdentifier(req, 'abc-123')).toBe('user:abc-123');
	});

	it('x-real-ip があればそれを使う（XFF左端の偽値を無視）', () => {
		const req = reqWith({
			'x-forwarded-for': 'evil-spoofed-ip, 203.0.113.9',
			'x-real-ip': '203.0.113.9'
		});
		expect(getClientIdentifier(req)).toBe('ip:203.0.113.9');
	});

	it('x-real-ip が無い場合は x-forwarded-for の右端ホップ（Vercel付与）を使う', () => {
		// 攻撃者が左端に偽IPを prepend しても、右端の実接続元IPが使われる
		const req = reqWith({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' });
		expect(getClientIdentifier(req)).toBe('ip:198.51.100.7');
	});

	it('左端の偽IPはキーに使われない（バイパス不可の確認）', () => {
		const spoofed = reqWith({ 'x-forwarded-for': '10.0.0.1, 198.51.100.7' });
		const honest = reqWith({ 'x-forwarded-for': '198.51.100.7' });
		// 偽値を変えても同一の実IPなら同一キー → ローテーションでバイパスできない
		expect(getClientIdentifier(spoofed)).toBe(getClientIdentifier(honest));
		expect(getClientIdentifier(spoofed)).toBe('ip:198.51.100.7');
	});

	it('単一ホップの x-forwarded-for はそのIPを使う', () => {
		const req = reqWith({ 'x-forwarded-for': '127.0.0.1' });
		expect(getClientIdentifier(req)).toBe('ip:127.0.0.1');
	});

	it('IPヘッダが無ければ ip:unknown', () => {
		const req = reqWith({});
		expect(getClientIdentifier(req)).toBe('ip:unknown');
	});
});
