import { describe, it, expect } from 'vitest';
import { decideRequest } from '$lib/offline/swRouting';

const ORIGIN = 'https://tento.app';
const context = {
	origin: ORIGIN,
	isAsset: (pathname: string) =>
		['/_app/immutable/entry/app.js', '/icon-192.png', '/offline', '/manifest.webmanifest'].includes(
			pathname
		)
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

	it('不変サブリソース（ハッシュ名 JS/CSS・アイコン等）は cache-first', () => {
		expect(decideRequest(req(`${ORIGIN}/_app/immutable/entry/app.js`), context)).toBe('asset');
		expect(decideRequest(req(`${ORIGIN}/icon-192.png`), context)).toBe('asset');
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

	it('プリレンダー済みページへのナビゲーションは precache 対象でも network-first（法的ページの鮮度優先）', () => {
		// /offline も isAsset=true だが、navigate では network-first にしてオンライン時は最新を取る
		expect(decideRequest(req(`${ORIGIN}/offline`, 'GET', 'navigate'), context)).toBe('navigation');
		// isAsset に含まれるプリレンダーページ（例: /faq）でも navigate なら navigation
		const withFaq = {
			...context,
			isAsset: (p: string) => context.isAsset(p) || p === '/faq'
		};
		expect(decideRequest(req(`${ORIGIN}/faq`, 'GET', 'navigate'), withFaq)).toBe('navigation');
		// 一方、ナビゲーションでない同ページ取得（サブリソース）は cache-first のまま
		expect(decideRequest(req(`${ORIGIN}/offline`), context)).toBe('asset');
	});

	it('その他の同一オリジン GET（非資産・非遷移）は素通し', () => {
		expect(decideRequest(req(`${ORIGIN}/some-endpoint`), context)).toBe('passthrough');
	});

	it('不正な URL は素通し', () => {
		expect(decideRequest(req('not-a-url'), context)).toBe('passthrough');
	});
});
