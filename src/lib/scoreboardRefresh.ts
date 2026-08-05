import {
	createSerializedAsync,
	DEFAULT_POLL_TIMEOUT_MS,
	type SerializedAsyncHandle
} from '$lib/serializedAsync';

/**
 * Scoreboard data refresh without recreating the page.
 * SvelteKit invalidation reruns load while preserving local UI state such as
 * the selected tab and the browser's scroll position.
 */
export function createScoreboardDataRefresher(
	invalidate: () => Promise<void>,
	onError: (error: unknown) => void = (error) =>
		console.error('[scoreboard] data refresh failed:', error)
): SerializedAsyncHandle {
	// ⚠️ 期限は必須。これは realtime の pollingFn として使われるため、invalidate()
	// （SvelteKit の invalidateAll）がハングすると内側の錠が永久に残り、以後スコアボードが
	// 更新されなくなる。**外側の realtime の期限では内側の錠は解放されない**。
	//
	// ⚠️ **この経路は「常に1件だけ実行」を保証しない。** 保証するのは「停止しないこと」だけ。
	//
	// invalidateAll は AbortSignal を受け付けないため、期限切れでも実際の再読込は中断できない。
	// 結果として、期限切れ後に新しい更新が始まり、古い再読込と**重複したサーバーリクエスト**が
	// 走り得る。表示は次回の更新で自己修復する前提で運用する。
	//
	// これを厳密に1件へ抑えるには、invalidateAll をやめて signal 付き fetch に置き換える必要が
	// あるが、スコアボードの load は公開ページ（service role）と認証ページ（RLS）で認可モデルが
	// 異なるため、API を2本用意して認可を二重管理することになる。重複リクエスト1本を避ける対価
	// としては割に合わないと判断した（判断の経緯は docs/architecture/polling-constraints.md）。
	return createSerializedAsync(invalidate, {
		pendingDelayMs: 0,
		timeoutMs: DEFAULT_POLL_TIMEOUT_MS,
		onError
	});
}
