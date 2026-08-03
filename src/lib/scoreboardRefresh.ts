import { createSerializedAsync, type SerializedAsyncHandle } from '$lib/serializedAsync';

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
	return createSerializedAsync(invalidate, { pendingDelayMs: 0, onError });
}
