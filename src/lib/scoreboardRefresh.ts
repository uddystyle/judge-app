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
	// なお invalidateAll は AbortSignal を受け付けないため、期限切れでも実際の再読込は
	// 中断できない（錠の解放＝以後の更新が再開できることの担保に留まる）。
	return createSerializedAsync(invalidate, {
		pendingDelayMs: 0,
		timeoutMs: DEFAULT_POLL_TIMEOUT_MS,
		onError
	});
}
