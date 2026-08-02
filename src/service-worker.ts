/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';
import { decideRequest } from '$lib/offline/swRouting';

/**
 * Service Worker（network-resilience-strategy.md Phase 5）
 *
 * 役割は「アプリ本体の読み込み失敗を減らす」ことだけ:
 * - ビルド資産（JS/CSS）・静的ファイル・プリレンダー済みページを precache し cache-first で返す
 * - ページ遷移は network-first。到達不能時のみ /offline を返す
 * - API・__data.json・POST・他オリジンには一切介入しない
 * 採点データの正本は IndexedDB / 同期キュー（Phase 1-2）。SW はデータを持たない。
 *
 * 更新は既定ライフサイクル（skipWaiting しない）: 新しい SW は全タブが閉じた後に
 * 有効化される。稼働中の旧クライアントのチャンクを消して壊さないため。
 */

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `tento-app-${version}`;
const ASSETS = [...build, ...files, ...prerendered];
const ASSET_SET = new Set(ASSETS);
const OFFLINE_FALLBACK = '/offline';

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
	);
});

async function serveAsset(request: Request, pathname: string): Promise<Response> {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(pathname);
	if (cached) return cached;
	// precache 漏れの保険: ネットワークから取得し、成功したらキャッシュへ
	try {
		const response = await fetch(request);
		if (response.ok) {
			cache.put(pathname, response.clone());
		}
		return response;
	} catch {
		return Response.error();
	}
}

async function serveNavigation(request: Request): Promise<Response> {
	try {
		// オンライン時は常に最新（サーバーエラーもそのまま見せる）
		return await fetch(request);
	} catch {
		// ネットワーク到達不能。まず precache 済みの当該ページ（プリレンダー済みなら存在）、
		// 無ければ汎用の /offline ページ
		const cache = await caches.open(CACHE);
		const cached = await cache.match(new URL(request.url).pathname);
		if (cached) return cached;
		const fallback = await cache.match(OFFLINE_FALLBACK);
		return fallback ?? Response.error();
	}
}

sw.addEventListener('fetch', (event) => {
	const decision = decideRequest(
		{ method: event.request.method, url: event.request.url, mode: event.request.mode },
		{ origin: sw.location.origin, isAsset: (pathname) => ASSET_SET.has(pathname) }
	);

	if (decision === 'asset') {
		event.respondWith(serveAsset(event.request, new URL(event.request.url).pathname));
	} else if (decision === 'navigation') {
		event.respondWith(serveNavigation(event.request));
	}
	// 'passthrough' は respondWith しない = ブラウザの通常処理
});
