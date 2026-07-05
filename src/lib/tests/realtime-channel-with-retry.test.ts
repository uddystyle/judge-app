/**
 * createRealtimeChannelWithRetry ユニットテスト
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	createRealtimeChannel,
	createRealtimeChannelWithRetry,
	createSessionMonitorChannel,
	createSessionMonitorWithPolling,
	type RealtimeChannelWithRetryConfig
} from '../realtime';

// --- Controllable mock Supabase client ---

interface MockChannel {
	channelName: string;
	subscribeCallback: ((status: string) => void) | null;
	payloadCallback: ((payload: any) => void) | null;
}

function createRetryTestSupabase() {
	const channels: MockChannel[] = [];
	let removedCount = 0;

	const supabase = {
		channel(name: string) {
			const ch: MockChannel = {
				channelName: name,
				subscribeCallback: null,
				payloadCallback: null
			};
			channels.push(ch);

			const chainable = {
				on(_event: string, _filter: any, callback: (payload: any) => void) {
					ch.payloadCallback = callback;
					return chainable;
				},
				subscribe(callback: (status: string) => void) {
					ch.subscribeCallback = callback;
					// Do NOT auto-fire SUBSCRIBED — tests control status manually
					return ch;
				}
			};
			return chainable;
		},
		removeChannel(_channel: any) {
			removedCount++;
		},
		get _channels() {
			return channels;
		},
		get _removedCount() {
			return removedCount;
		},
		/** Fire status on the latest channel */
		_fireStatus(status: string, channelIndex?: number) {
			const idx = channelIndex ?? channels.length - 1;
			channels[idx].subscribeCallback!(status);
		}
	};

	return supabase;
}

function makeConfig(
	overrides: Partial<RealtimeChannelWithRetryConfig> = {}
): RealtimeChannelWithRetryConfig {
	return {
		channelName: 'test-channel',
		table: 'scores',
		filter: 'event_id=eq.123',
		onPayload: vi.fn(),
		pollingFn: vi.fn().mockResolvedValue(undefined),
		onConnectionError: vi.fn(),
		maxRetryCount: 3,
		pollingIntervalMs: 1000,
		...overrides
	};
}

describe('createRealtimeChannelWithRetry', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('初回接続成功時にonConnectionError(false)が呼ばれる', () => {
		const supabase = createRetryTestSupabase();
		const config = makeConfig();

		const handle = createRealtimeChannelWithRetry(supabase as any, config);

		// Manually fire SUBSCRIBED
		supabase._fireStatus('SUBSCRIBED');

		expect(config.onConnectionError).toHaveBeenCalledWith(false);
		expect(handle.hasConnectionError()).toBe(false);

		handle.cleanup();
	});

	it('CHANNEL_ERROR後にリトライが指数バックオフで実行される', async () => {
		const supabase = createRetryTestSupabase();
		const config = makeConfig({ maxRetryCount: 3 });

		const handle = createRealtimeChannelWithRetry(supabase as any, config);
		expect(supabase._channels.length).toBe(1);

		// Error on initial channel → retry scheduled at 1000ms (2^0 * 1000)
		supabase._fireStatus('CHANNEL_ERROR');
		expect(config.onConnectionError).toHaveBeenCalledWith(true);

		// Before backoff: no new channel
		await vi.advanceTimersByTimeAsync(999);
		expect(supabase._channels.length).toBe(1);

		// After backoff: new channel created
		await vi.advanceTimersByTimeAsync(1);
		expect(supabase._channels.length).toBe(2);

		handle.cleanup();
	});

	it('最大リトライ回数到達後にフォールバックポーリングが開始される', async () => {
		const supabase = createRetryTestSupabase();
		const config = makeConfig({ maxRetryCount: 2, pollingIntervalMs: 500 });

		const handle = createRealtimeChannelWithRetry(supabase as any, config);

		// Error 1 → retry 1 at 1000ms
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(1000);
		expect(supabase._channels.length).toBe(2);

		// Error 2 → retry 2 at 2000ms
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(2000);
		expect(supabase._channels.length).toBe(3);

		// Error 3 → max retries reached, fallback polling starts (no more retries)
		supabase._fireStatus('CHANNEL_ERROR');

		// Polling should fire on interval
		await vi.advanceTimersByTimeAsync(500);
		expect(config.pollingFn).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(500);
		expect(config.pollingFn).toHaveBeenCalledTimes(2);

		handle.cleanup();
	});

	it('manualRefresh()がretryTimerをクリアし重複setupChannelを防ぐ', async () => {
		const supabase = createRetryTestSupabase();
		const config = makeConfig({ maxRetryCount: 5 });

		const handle = createRealtimeChannelWithRetry(supabase as any, config);
		expect(supabase._channels.length).toBe(1);

		// CHANNEL_ERROR → triggers retry with 1s backoff
		supabase._fireStatus('CHANNEL_ERROR');

		// Before retry timer fires, call manualRefresh()
		// This should clear the pending retryTimer AND create a new channel
		await handle.manualRefresh();
		const channelsAfterRefresh = supabase._channels.length;
		expect(channelsAfterRefresh).toBe(2); // initial + manualRefresh

		// Now advance past the original retry backoff (1000ms)
		// If retryTimer was NOT cleared, a third channel would be created
		await vi.advanceTimersByTimeAsync(2000);
		expect(supabase._channels.length).toBe(channelsAfterRefresh);

		handle.cleanup();
	});

	it('manualRefresh()がfallbackPollingを停止する', async () => {
		const supabase = createRetryTestSupabase();
		const config = makeConfig({ maxRetryCount: 1, pollingIntervalMs: 200 });

		const handle = createRealtimeChannelWithRetry(supabase as any, config);

		// Error → retry 1
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(1000);

		// Error on retry → max retries reached → fallback polling starts
		supabase._fireStatus('CHANNEL_ERROR');

		// Polling active
		await vi.advanceTimersByTimeAsync(200);
		expect(config.pollingFn).toHaveBeenCalledTimes(1);

		// manualRefresh should stop polling
		await handle.manualRefresh();
		(config.pollingFn as any).mockClear();

		// Advance time — polling should NOT fire (interval was cleared)
		await vi.advanceTimersByTimeAsync(600);
		expect(config.pollingFn).not.toHaveBeenCalled();

		handle.cleanup();
	});

	it('接続成功後にretryCountがリセットされる', async () => {
		const supabase = createRetryTestSupabase();
		const config = makeConfig({ maxRetryCount: 3 });

		const handle = createRealtimeChannelWithRetry(supabase as any, config);

		// Error → retry at 1s
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(1000);
		expect(supabase._channels.length).toBe(2);

		// New channel connects successfully → retryCount resets to 0
		supabase._fireStatus('SUBSCRIBED');
		expect(handle.hasConnectionError()).toBe(false);

		// Another error should start from retryCount=0 (backoff = 2^0 * 1000 = 1s)
		supabase._fireStatus('CHANNEL_ERROR');
		const channelsBefore = supabase._channels.length;

		await vi.advanceTimersByTimeAsync(1000);
		expect(supabase._channels.length).toBe(channelsBefore + 1);

		handle.cleanup();
	});

	it('cleanup()がすべてのタイマーとチャンネルを解放する', async () => {
		const supabase = createRetryTestSupabase();
		const config = makeConfig({ maxRetryCount: 5 });

		const handle = createRealtimeChannelWithRetry(supabase as any, config);

		// Trigger error to start retry timer
		supabase._fireStatus('CHANNEL_ERROR');

		// Cleanup before retry fires
		handle.cleanup();

		const channelsAfterCleanup = supabase._channels.length;
		await vi.advanceTimersByTimeAsync(2000);

		// No new channels should be created after cleanup
		expect(supabase._channels.length).toBe(channelsAfterCleanup);
	});
});

// --- Session monitor tests ---

function createSessionMonitorSupabase() {
	const channels: MockChannel[] = [];

	const supabase = {
		channel(name: string) {
			const ch: MockChannel = {
				channelName: name,
				subscribeCallback: null,
				payloadCallback: null
			};
			channels.push(ch);

			const chainable = {
				on(_event: string, _filter: any, callback: (payload: any) => void) {
					ch.payloadCallback = callback;
					return chainable;
				},
				subscribe(callback: (status: string) => void) {
					ch.subscribeCallback = callback;
					return ch;
				}
			};
			return chainable;
		},
		removeChannel: vi.fn(),
		from: vi.fn(() => ({
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			single: vi
				.fn()
				.mockResolvedValue({ data: { is_active: true, active_prompt_id: null }, error: null })
		})),
		get _channels() {
			return channels;
		},
		_fireStatus(status: string, index?: number) {
			const idx = index ?? channels.length - 1;
			channels[idx].subscribeCallback!(status);
		}
	};

	return supabase;
}

describe('createSessionMonitorChannel - errorReloadTimer cleanup', () => {
	let reloadMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		reloadMock = vi.fn();
		Object.defineProperty(window, 'location', {
			value: { reload: reloadMock },
			writable: true,
			configurable: true
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('CHANNEL_ERROR後にcleanupするとreloadが発火しない', async () => {
		const supabase = createSessionMonitorSupabase();
		const handle = createSessionMonitorChannel(supabase as any, {
			sessionId: 'sess-1',
			onPayload: vi.fn()
		});

		// Trigger error → 2s reload timer starts
		supabase._fireStatus('CHANNEL_ERROR');

		// Cleanup before 2s elapses
		handle.cleanup();

		// Advance past the 2s reload delay
		await vi.advanceTimersByTimeAsync(3000);

		// reload should NOT have been called
		expect(reloadMock).not.toHaveBeenCalled();
	});

	it('エラー時は即reloadせず再購読する（backoffで新チャンネル）', async () => {
		const supabase = createSessionMonitorSupabase();
		const handle = createSessionMonitorChannel(supabase as any, {
			sessionId: 'sess-1',
			onPayload: vi.fn(),
			maxRetryCount: 5
		});
		expect(supabase._channels.length).toBe(1);

		// エラー → 即 reload せず、1s backoff で再購読
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(1000);
		expect(supabase._channels.length).toBe(2);
		expect(reloadMock).not.toHaveBeenCalled();

		handle.cleanup();
	});

	it('再購読を使い切ると最終手段のreloadが発火する', async () => {
		const supabase = createSessionMonitorSupabase();
		const handle = createSessionMonitorChannel(supabase as any, {
			sessionId: 'sess-1',
			onPayload: vi.fn(),
			maxRetryCount: 2
		});

		// error1 → backoff 1s で再購読
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(1000);
		expect(supabase._channels.length).toBe(2);
		expect(reloadMock).not.toHaveBeenCalled();

		// error2 → backoff 2s で再購読
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(2000);
		expect(supabase._channels.length).toBe(3);
		expect(reloadMock).not.toHaveBeenCalled();

		// error3 → 再購読を使い切った → 2s 後に reload
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(2000);
		expect(reloadMock).toHaveBeenCalledOnce();

		handle.cleanup();
	});

	it('onError指定時は最終手段でonErrorが呼ばれreloadしない', async () => {
		const supabase = createSessionMonitorSupabase();
		const onError = vi.fn();
		const handle = createSessionMonitorChannel(supabase as any, {
			sessionId: 'sess-1',
			onPayload: vi.fn(),
			onError,
			maxRetryCount: 1
		});

		// error1 → backoff 1s で再購読（onError はまだ呼ばれない）
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(1000);
		expect(onError).not.toHaveBeenCalled();

		// error2 → 再購読を使い切り → onError（reload しない）
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(3000);
		expect(onError).toHaveBeenCalledOnce();
		expect(reloadMock).not.toHaveBeenCalled();

		handle.cleanup();
	});

	it('CHANNEL_ERROR後にSUBSCRIBEDで回復するとreloadが発火しない', async () => {
		const supabase = createSessionMonitorSupabase();
		const handle = createSessionMonitorChannel(supabase as any, {
			sessionId: 'sess-1',
			onPayload: vi.fn()
		});

		// Error → 2s reload timer starts
		supabase._fireStatus('CHANNEL_ERROR');

		// Connection recovers within 2s
		await vi.advanceTimersByTimeAsync(500);
		supabase._fireStatus('SUBSCRIBED');

		// Advance past the original 2s deadline
		await vi.advanceTimersByTimeAsync(2000);

		expect(reloadMock).not.toHaveBeenCalled();

		handle.cleanup();
	});

	it('SUBSCRIBED復帰でretryCountがリセットされ、reloadが先送りされない', async () => {
		const supabase = createSessionMonitorSupabase();
		const handle = createSessionMonitorChannel(supabase as any, {
			sessionId: 'sess-1',
			onPayload: vi.fn(),
			maxRetryCount: 5
		});

		// error → 1s backoff で再購読
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(1000);
		expect(supabase._channels.length).toBe(2);

		// 再接続成功 → retryCount リセット
		supabase._fireStatus('SUBSCRIBED');

		// 次のエラーも先頭の backoff(1s) から再購読（リセットされている）
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(1000);
		expect(supabase._channels.length).toBe(3);
		expect(reloadMock).not.toHaveBeenCalled();

		handle.cleanup();
	});
});

describe('createSessionMonitorWithPolling - errorReloadTimer cleanup', () => {
	let reloadMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		reloadMock = vi.fn();
		Object.defineProperty(window, 'location', {
			value: { reload: reloadMock },
			writable: true,
			configurable: true
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('CHANNEL_ERROR後にcleanupするとreloadが発火しない', async () => {
		const supabase = createSessionMonitorSupabase();
		const handle = createSessionMonitorWithPolling(supabase as any, {
			sessionId: 'sess-1',
			onRealtimePayload: vi.fn(),
			onPollingData: vi.fn()
		});

		supabase._fireStatus('CHANNEL_ERROR');

		handle.cleanup();

		await vi.advanceTimersByTimeAsync(3000);

		expect(reloadMock).not.toHaveBeenCalled();
	});

	it('TIMED_OUT後にcleanupするとreloadが発火しない', async () => {
		const supabase = createSessionMonitorSupabase();
		const handle = createSessionMonitorWithPolling(supabase as any, {
			sessionId: 'sess-1',
			onRealtimePayload: vi.fn(),
			onPollingData: vi.fn()
		});

		supabase._fireStatus('TIMED_OUT');

		handle.cleanup();

		await vi.advanceTimersByTimeAsync(3000);

		expect(reloadMock).not.toHaveBeenCalled();
	});

	it('CHANNEL_ERROR後にSUBSCRIBEDで回復するとreloadが発火しない', async () => {
		const supabase = createSessionMonitorSupabase();
		const handle = createSessionMonitorWithPolling(supabase as any, {
			sessionId: 'sess-1',
			onRealtimePayload: vi.fn(),
			onPollingData: vi.fn()
		});

		// Error → 2s reload timer starts
		supabase._fireStatus('CHANNEL_ERROR');

		// Connection recovers within 2s
		await vi.advanceTimersByTimeAsync(500);
		supabase._fireStatus('SUBSCRIBED');

		// Advance past the original 2s deadline
		await vi.advanceTimersByTimeAsync(2000);

		expect(reloadMock).not.toHaveBeenCalled();

		handle.cleanup();
	});

	it('連続エラーでも即reloadせず再購読する', async () => {
		const supabase = createSessionMonitorSupabase();
		const handle = createSessionMonitorWithPolling(supabase as any, {
			sessionId: 'sess-1',
			onRealtimePayload: vi.fn(),
			onPollingData: vi.fn(),
			maxRetryCount: 5
		});

		// 3回連続でエラー → 各回 retryTimer が上書き、即 reload はしない（再購読中）
		supabase._fireStatus('CHANNEL_ERROR');
		supabase._fireStatus('TIMED_OUT');
		supabase._fireStatus('CHANNEL_ERROR');

		await vi.advanceTimersByTimeAsync(2000);
		expect(reloadMock).not.toHaveBeenCalled();

		handle.cleanup();
	});

	it('SUBSCRIBEDが複数回来てもpollingが多重化しない', async () => {
		const supabase = createSessionMonitorSupabase();
		const onPollingData = vi.fn();
		const handle = createSessionMonitorWithPolling(supabase as any, {
			sessionId: 'sess-1',
			pollingIntervalMs: 500,
			onRealtimePayload: vi.fn(),
			onPollingData
		});

		// 1回目のSUBSCRIBED → polling開始
		supabase._fireStatus('SUBSCRIBED');

		// 2回目のSUBSCRIBED（再接続） → 古いintervalをclearしてから新規登録
		supabase._fireStatus('SUBSCRIBED');

		// 3回目のSUBSCRIBED
		supabase._fireStatus('SUBSCRIBED');

		// 500ms経過 → pollingが1回だけ発火すること（多重化していれば3回）
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);

		// さらに500ms → 累計2回
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(2);

		handle.cleanup();
	});

	it('CHANNEL_ERROR中もpollingは継続し、SUBSCRIBED復帰後も1本だけ', async () => {
		const supabase = createSessionMonitorSupabase();
		const onPollingData = vi.fn();
		const handle = createSessionMonitorWithPolling(supabase as any, {
			sessionId: 'sess-1',
			pollingIntervalMs: 500,
			onRealtimePayload: vi.fn(),
			onPollingData,
			onError: vi.fn() // reloadを防ぐ
		});

		// 初回接続 → polling開始
		supabase._fireStatus('SUBSCRIBED');
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);

		// エラー発生 → pollingは止めず継続（再購読中の取りこぼし保険）
		onPollingData.mockClear();
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);

		// 復帰 → polling再開、多重化しない（1本）
		supabase._fireStatus('SUBSCRIBED');
		onPollingData.mockClear();
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(2);

		handle.cleanup();
	});

	it('エラー/復帰を複数サイクル繰り返してもpollingは常に1本（停止しない）', async () => {
		const supabase = createSessionMonitorSupabase();
		const onPollingData = vi.fn();
		const handle = createSessionMonitorWithPolling(supabase as any, {
			sessionId: 'sess-1',
			pollingIntervalMs: 500,
			onRealtimePayload: vi.fn(),
			onPollingData,
			onError: vi.fn()
		});

		for (let cycle = 0; cycle < 3; cycle++) {
			// 接続 → polling（1本）
			supabase._fireStatus('SUBSCRIBED');
			onPollingData.mockClear();
			await vi.advanceTimersByTimeAsync(500);
			expect(onPollingData).toHaveBeenCalledTimes(1);

			// エラー → polling は継続（停止しない）
			supabase._fireStatus('CHANNEL_ERROR');
			onPollingData.mockClear();
			await vi.advanceTimersByTimeAsync(500);
			expect(onPollingData).toHaveBeenCalledTimes(1);
		}

		handle.cleanup();
	});

	it('cleanup()後にpollingが残らない', async () => {
		const supabase = createSessionMonitorSupabase();
		const onPollingData = vi.fn();
		const handle = createSessionMonitorWithPolling(supabase as any, {
			sessionId: 'sess-1',
			pollingIntervalMs: 500,
			onRealtimePayload: vi.fn(),
			onPollingData
		});

		// polling開始
		supabase._fireStatus('SUBSCRIBED');
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);

		// cleanup
		handle.cleanup();
		onPollingData.mockClear();

		// cleanup後はpollingが発火しないこと
		await vi.advanceTimersByTimeAsync(2000);
		expect(onPollingData).not.toHaveBeenCalled();
	});

	it('SUBSCRIBED → CHANNEL_ERROR → SUBSCRIBED → SUBSCRIBED の遷移でpollingが1本に保たれる', async () => {
		const supabase = createSessionMonitorSupabase();
		const onPollingData = vi.fn();
		const onError = vi.fn();
		const handle = createSessionMonitorWithPolling(supabase as any, {
			sessionId: 'sess-1',
			pollingIntervalMs: 500,
			onRealtimePayload: vi.fn(),
			onPollingData,
			onError
		});

		// Phase 1: 初回 SUBSCRIBED → polling 1本
		supabase._fireStatus('SUBSCRIBED');
		onPollingData.mockClear();
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);

		// Phase 2: CHANNEL_ERROR → polling 継続、onError は最終手段なので即時には呼ばれない
		supabase._fireStatus('CHANNEL_ERROR');
		expect(onError).not.toHaveBeenCalled();
		onPollingData.mockClear();
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);

		// Phase 3: 復帰 SUBSCRIBED → polling 再開（1本）
		supabase._fireStatus('SUBSCRIBED');
		onPollingData.mockClear();
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(2);

		// Phase 4: さらに SUBSCRIBED（再購読イベントの多重発火） → 増殖しない
		supabase._fireStatus('SUBSCRIBED');
		onPollingData.mockClear();
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(2);

		handle.cleanup();

		// cleanup 後に一切のタイマーが残っていないことを確認
		onPollingData.mockClear();
		await vi.advanceTimersByTimeAsync(2000);
		expect(onPollingData).not.toHaveBeenCalled();
	});

	it('error timer はSUBSCRIBED復帰でキャンセルされ、cleanup不要でもreloadしない', async () => {
		const supabase = createSessionMonitorSupabase();
		const reloadMock = vi.fn();
		Object.defineProperty(window, 'location', {
			value: { reload: reloadMock },
			writable: true,
			configurable: true
		});

		const onPollingData = vi.fn();
		const handle = createSessionMonitorWithPolling(supabase as any, {
			sessionId: 'sess-1',
			pollingIntervalMs: 500,
			onRealtimePayload: vi.fn(),
			onPollingData
			// onError 未指定 → デフォルトの reload タイマー(2s)が登録される
		});

		// SUBSCRIBED → polling開始
		supabase._fireStatus('SUBSCRIBED');
		onPollingData.mockClear();
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);

		// CHANNEL_ERROR → 即 reload せず再購読、polling は継続
		supabase._fireStatus('CHANNEL_ERROR');
		onPollingData.mockClear();

		// 1s 経過しても polling は継続、reload しない
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);
		expect(reloadMock).not.toHaveBeenCalled();

		supabase._fireStatus('SUBSCRIBED');

		// reload timer の 2s を越えても reload が発火しないこと
		await vi.advanceTimersByTimeAsync(2000);
		expect(reloadMock).not.toHaveBeenCalled();

		// polling は復帰後きちんと1本動いている
		onPollingData.mockClear();
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);

		handle.cleanup();
	});

	it('CHANNEL_ERROR連打 → SUBSCRIBED でも polling 1本・error timer 0本', async () => {
		const supabase = createSessionMonitorSupabase();
		const reloadMock = vi.fn();
		Object.defineProperty(window, 'location', {
			value: { reload: reloadMock },
			writable: true,
			configurable: true
		});

		const onPollingData = vi.fn();
		const handle = createSessionMonitorWithPolling(supabase as any, {
			sessionId: 'sess-1',
			pollingIntervalMs: 500,
			onRealtimePayload: vi.fn(),
			onPollingData
		});

		// 初回接続
		supabase._fireStatus('SUBSCRIBED');

		// 3連続エラー（各回 reload timer が上書きされるはず）
		supabase._fireStatus('CHANNEL_ERROR');
		supabase._fireStatus('TIMED_OUT');
		supabase._fireStatus('CHANNEL_ERROR');

		// polling はエラー中も継続
		onPollingData.mockClear();
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);

		// 復帰 → polling 再開
		supabase._fireStatus('SUBSCRIBED');

		// 3s を超えても reload しない（再購読を使い切っていない）
		await vi.advanceTimersByTimeAsync(3000);
		expect(reloadMock).not.toHaveBeenCalled();

		// polling は 500ms ごとに 1回ずつ
		onPollingData.mockClear();
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(500);
		expect(onPollingData).toHaveBeenCalledTimes(2);

		handle.cleanup();
		onPollingData.mockClear();
		await vi.advanceTimersByTimeAsync(1000);
		expect(onPollingData).not.toHaveBeenCalled();
	});
});

// --- createRealtimeChannel 自動再購読（scoreboard 等） ---

describe('createRealtimeChannel - 自動再購読', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function makeSimpleConfig(overrides: Record<string, any> = {}) {
		return {
			channelName: 'sb-channel',
			table: 'results',
			filter: 'session_id=eq.1',
			onPayload: vi.fn(),
			...overrides
		};
	}

	it('エラー時にバックオフで再購読する（従来は no-op）', async () => {
		const supabase = createRetryTestSupabase();
		const handle = createRealtimeChannel(supabase as any, makeSimpleConfig({ maxRetryCount: 3 }));
		expect(supabase._channels.length).toBe(1);

		supabase._fireStatus('CHANNEL_ERROR');
		// backoff 前は新チャンネル無し
		await vi.advanceTimersByTimeAsync(999);
		expect(supabase._channels.length).toBe(1);
		// backoff 後に再購読
		await vi.advanceTimersByTimeAsync(1);
		expect(supabase._channels.length).toBe(2);

		handle.cleanup();
	});

	it('SUBSCRIBEDでretryCountがリセットされる', async () => {
		const supabase = createRetryTestSupabase();
		const handle = createRealtimeChannel(supabase as any, makeSimpleConfig({ maxRetryCount: 3 }));

		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(1000);
		expect(supabase._channels.length).toBe(2);

		// 再接続成功
		supabase._fireStatus('SUBSCRIBED');

		// 次のエラーも先頭の backoff(1s) から（リセット済み）
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(1000);
		expect(supabase._channels.length).toBe(3);

		handle.cleanup();
	});

	it('最大リトライ到達後は再購読を諦める', async () => {
		const supabase = createRetryTestSupabase();
		const handle = createRealtimeChannel(supabase as any, makeSimpleConfig({ maxRetryCount: 2 }));

		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(1000);
		expect(supabase._channels.length).toBe(2);

		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(2000);
		expect(supabase._channels.length).toBe(3);

		// max 到達 → これ以上再購読しない
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(10000);
		expect(supabase._channels.length).toBe(3);

		handle.cleanup();
	});

	it('cleanup()後は再購読しない', async () => {
		const supabase = createRetryTestSupabase();
		const handle = createRealtimeChannel(supabase as any, makeSimpleConfig({ maxRetryCount: 5 }));

		supabase._fireStatus('CHANNEL_ERROR');
		handle.cleanup();
		await vi.advanceTimersByTimeAsync(5000);
		expect(supabase._channels.length).toBe(1);
	});
});

describe('createRealtimeChannelWithRetry - 取りこぼし対策オプション（session/[id] 待機画面向け）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('onSubscribed がSUBSCRIBEDごとに呼ばれる（初回チェック用フック）', () => {
		const supabase = createRetryTestSupabase();
		const onSubscribed = vi.fn();
		const handle = createRealtimeChannelWithRetry(supabase as any, makeConfig({ onSubscribed }));

		supabase._fireStatus('SUBSCRIBED');
		expect(onSubscribed).toHaveBeenCalledTimes(1);

		// 再接続復帰でも呼ばれる
		supabase._fireStatus('SUBSCRIBED');
		expect(onSubscribed).toHaveBeenCalledTimes(2);

		handle.cleanup();
	});

	it('startPollingImmediately: 購読確立前からポーリングし、SUBSCRIBEDで停止する', async () => {
		const supabase = createRetryTestSupabase();
		const config = makeConfig({ startPollingImmediately: true });
		const handle = createRealtimeChannelWithRetry(supabase as any, config);

		// まだステータスは来ていないが、ポーリングは動いている
		await vi.advanceTimersByTimeAsync(2000);
		expect(config.pollingFn).toHaveBeenCalledTimes(2);

		// SUBSCRIBED で停止
		supabase._fireStatus('SUBSCRIBED');
		await vi.advanceTimersByTimeAsync(3000);
		expect(config.pollingFn).toHaveBeenCalledTimes(2);

		handle.cleanup();
	});

	it('startPollingOnErrorStatus: リトライ上限を待たず初回エラーでポーリングを開始する', async () => {
		const supabase = createRetryTestSupabase();
		const config = makeConfig({ startPollingOnErrorStatus: true });
		const handle = createRealtimeChannelWithRetry(supabase as any, config);

		supabase._fireStatus('SUBSCRIBED');
		expect(config.pollingFn).not.toHaveBeenCalled();

		// 初回エラーで即ポーリング開始（従来は maxRetry 到達後のみ）
		supabase._fireStatus('CHANNEL_ERROR');
		await vi.advanceTimersByTimeAsync(1000);
		expect(config.pollingFn).toHaveBeenCalledTimes(1);

		// 復帰したら停止
		await vi.advanceTimersByTimeAsync(1000); // バックオフ再購読を発火させる
		supabase._fireStatus('SUBSCRIBED');
		const callsAtRecovery = vi.mocked(config.pollingFn).mock.calls.length;
		await vi.advanceTimersByTimeAsync(3000);
		expect(config.pollingFn).toHaveBeenCalledTimes(callsAtRecovery);

		handle.cleanup();
	});
});
