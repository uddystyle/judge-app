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
	/** ハッシュ名で不変のサブリソース（JS/CSS/アイコン等）: cache-first */
	| 'asset'
	/** ページ遷移: network-first。オフライン時のみ precache / fallback ページ */
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

	// ページ遷移は network-first。isAsset より先に判定するのが要点:
	// プリレンダー済みページ（/faq /legal /privacy /terms /offline）も precache 対象だが、
	// ナビゲーションではオンライン時に最新を取りに行く（法的ページ=規約/特商法/プライバシーの
	// 更新が SW 世代まで遅延しないように）。オフライン時は serveNavigation が precache へ
	// フォールバックするので可用性は保たれる。SSR HTML はそもそもキャッシュしない
	// （古い bib 等が埋まったページの再配信は誤採点の温床）。
	if (request.mode === 'navigate') return 'navigation';

	// 不変サブリソース（/_app/immutable/... はハッシュ名、アイコン・manifest 等）: cache-first
	if (context.isAsset(url.pathname)) return 'asset';

	return 'passthrough';
}
