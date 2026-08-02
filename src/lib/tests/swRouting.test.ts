import { describe, it, expect } from 'vitest';
import { decideRequest } from '$lib/offline/swRouting';

const ORIGIN = 'https://tento.app';
const context = {
	origin: ORIGIN,
	isAsset: (pathname: string) =>
		[
			'/_app/immutable/entry/app.js',
			'/icons/icon-192.png',
			'/offline',
			'/manifest.webmanifest'
		].includes(pathname)
};

const req = (url: string, method = 'GET', mode?: string) => ({ method, url, mode });

describe('decideRequest（SW の振り分け）', () => {
	it('POST 等の非 GET は絶対に介入しない', () => {
		expect(decideRequest(req(`${ORIGIN}/api/sync/scores`, 'POST'), context)).toBe('passthrough');
		expect(
			decideRequest(
				req(`${ORIGIN}/session/1/score/training/10/input?/submitScore`, 'POST'),
				context
			)
		).toBe('passthrough');
	});

	it('他オリジン（Supabase / Google Fonts）は素通し', () => {
		expect(decideRequest(req('https://xyz.supabase.co/auth/v1/token'), context)).toBe(
			'passthrough'
		);
		expect(decideRequest(req('https://fonts.gstatic.com/font.woff2'), context)).toBe('passthrough');
	});

	it('API とサーバーデータ（__data.json）は常にネットワーク', () => {
		expect(decideRequest(req(`${ORIGIN}/api/sessions/1/offline-bundle`), context)).toBe(
			'passthrough'
		);
		expect(decideRequest(req(`${ORIGIN}/api/score-status/1/5`), context)).toBe('passthrough');
		expect(decideRequest(req(`${ORIGIN}/dashboard/__data.json`), context)).toBe('passthrough');
		expect(
			decideRequest(req(`${ORIGIN}/session/1/__data.json?x-sveltekit-invalidated=01`), context)
		).toBe('passthrough');
	});

	it('プリキャッシュ対象（ビルド資産・静的・プリレンダー済み）は cache-first', () => {
		expect(decideRequest(req(`${ORIGIN}/_app/immutable/entry/app.js`), context)).toBe('asset');
		expect(decideRequest(req(`${ORIGIN}/icons/icon-192.png`), context)).toBe('asset');
		expect(decideRequest(req(`${ORIGIN}/offline`, 'GET', 'navigate'), context)).toBe('asset');
	});

	it('ページ遷移は navigation（network-first + オフライン fallback）', () => {
		expect(decideRequest(req(`${ORIGIN}/dashboard`, 'GET', 'navigate'), context)).toBe(
			'navigation'
		);
		expect(
			decideRequest(
				req(`${ORIGIN}/session/1/score/training/10/input?bib=5`, 'GET', 'navigate'),
				context
			)
		).toBe('navigation');
	});

	it('その他の同一オリジン GET（非資産・非遷移）は素通し', () => {
		expect(decideRequest(req(`${ORIGIN}/some-endpoint`), context)).toBe('passthrough');
	});

	it('不正な URL は素通し', () => {
		expect(decideRequest(req('not-a-url'), context)).toBe('passthrough');
	});
});
