import { describe, expect, it, vi } from 'vitest';
import { createScoreboardDataRefresher } from './scoreboardRefresh';

describe('createScoreboardDataRefresher', () => {
	it('SvelteKitのinvalidateを使ってデータだけを再取得する', async () => {
		const invalidate = vi.fn().mockResolvedValue(undefined);
		const refresher = createScoreboardDataRefresher(invalidate);

		await refresher.runAsync();

		expect(invalidate).toHaveBeenCalledOnce();
		refresher.cleanup();
	});

	it('Realtime通知とhealth pollingが重なっても同時実行しない', async () => {
		let resolveFirst!: () => void;
		const firstRefresh = new Promise<void>((resolve) => {
			resolveFirst = resolve;
		});
		const invalidate = vi
			.fn<() => Promise<void>>()
			.mockImplementationOnce(() => firstRefresh)
			.mockResolvedValue(undefined);
		const refresher = createScoreboardDataRefresher(invalidate);

		refresher.run();
		refresher.run();
		refresher.run();
		expect(invalidate).toHaveBeenCalledOnce();

		resolveFirst();
		await firstRefresh;
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(invalidate).toHaveBeenCalledTimes(2);
		refresher.cleanup();
	});
});
