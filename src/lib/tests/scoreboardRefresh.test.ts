import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScoreboardDataRefresher } from '$lib/scoreboardRefresh';

/**
 * スコアボード更新のハング耐性。
 *
 * ⚠️ これは realtime の pollingFn として使われる（scoreboard の2ページ）。
 * 期限が無いと invalidateAll() がハングしたときに内側の錠が永久に残り、
 * 以後スコアボードが更新されなくなる。
 * **外側（realtime）の期限では内側の錠は解放されない**ため、ここに期限が要る。
 */
describe('createScoreboardDataRefresher の期限', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('invalidate がハングしても期限で錠が解放され、次の更新が走る', async () => {
		let calls = 0;
		const refresher = createScoreboardDataRefresher(() => {
			calls++;
			return calls === 1 ? new Promise<void>(() => {}) : Promise.resolve();
		});

		refresher.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toBe(1);

		// 期限前は錠がかかったまま
		refresher.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toBe(1);

		// 期限を過ぎたら解放され、保留分が走る
		await vi.advanceTimersByTimeAsync(20000);
		expect(calls).toBe(2);
	});

	it('期限切れは onError で通知される（沈黙させない）', async () => {
		const onError = vi.fn();
		const refresher = createScoreboardDataRefresher(() => new Promise<void>(() => {}), onError);

		refresher.run();
		await vi.advanceTimersByTimeAsync(20000);

		expect(onError).toHaveBeenCalled();
	});
});
