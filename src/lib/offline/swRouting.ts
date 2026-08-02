/**
 * Service Worker のリクエスト振り分けロジック（network-resilience-strategy.md Phase 5）
 *
 * 純粋関数として切り出してユニットテスト可能にする。
 * 方針: SW は「アプリ本体（JS/CSS/静的ファイル/プリレンダー済みページ）」だけを
 * キャッシュし、データ（API・サーバーレンダリング・__data.json）は一切キャッシュしない。
 * 採点データの正本は IndexedDB / 同期キュー（Phase 1-2）であり、SW は関与しない。
 */

export type SwDecision =
	/** SW は介入しない（ネットワークへ素通し） */
	| 'passthrough'
	/** ビルド資産・静的ファイル・プリレンダー済みページ: cache-first */
	| 'asset'
	/** ページ遷移: network-first。失敗時のみオフライン fallback ページ */
	| 'navigation';

export interface SwRequestInfo {
	method: string;
	url: string;
	/** Request.mode（'navigate' ならページ遷移） */
	mode?: string;
}

export interface SwRoutingContext {
	/** SW のオリジン（location.origin） */
	origin: string;
	/** pathname がプリキャッシュ対象（build/files/prerendered）か */
	isAsset: (pathname: string) => boolean;
}

export function decideRequest(request: SwRequestInfo, context: SwRoutingContext): SwDecision {
	// データ変更系（POST 等）は絶対に介入しない
	if (request.method !== 'GET') return 'passthrough';

	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return 'passthrough';
	}

	// 他オリジン（Google Fonts / Supabase / Stripe）は素通し
	if (url.origin !== context.origin) return 'passthrough';

	// API とサーバーデータは常にネットワーク（鮮度が正義。オフライン時の採点は IndexedDB が担う）
	if (url.pathname.startsWith('/api/')) return 'passthrough';
	if (url.pathname.endsWith('/__data.json')) return 'passthrough';

	// プリキャッシュ済み資産（/_app/immutable/... はハッシュ名で不変）
	if (context.isAsset(url.pathname)) return 'asset';

	// ページ遷移: ネットワーク優先。SSR HTML はキャッシュしない
	// （古い bib 等が埋まったページを再配信すると誤採点の温床になるため）
	if (request.mode === 'navigate') return 'navigation';

	return 'passthrough';
}
