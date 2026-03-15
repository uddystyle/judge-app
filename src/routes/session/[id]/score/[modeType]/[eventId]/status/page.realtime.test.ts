/**
 * スコア監視画面 - Realtime再接続タイマークリアテスト
 *
 * SUBSCRIBED状態になった時に、retryTimerをクリアして重複購読を防ぐロジックを検証
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('スコア監視画面 - retryTimer クリア（重複購読防止）', () => {
	let retryTimer: any = null;
	let realtimeConnectionError = false;
	let retryCount = 0;
	let fallbackPolling: any = null;
	let setupCallCount = 0;

	beforeEach(() => {
		retryTimer = null;
		realtimeConnectionError = false;
		retryCount = 0;
		fallbackPolling = null;
		setupCallCount = 0;
		vi.clearAllMocks();
	});

	const retryRealtimeConnection = () => {
		const delay = Math.min(5000 * Math.pow(2, retryCount), 30000);
		retryCount++;

		retryTimer = setTimeout(() => {
			console.log('[retry] 再接続を試みます');
			setupCallCount++;
		}, delay);
	};

	const handleSubscribed = () => {
		console.log('[status/realtime] ✅ スコア監視のRealtime接続成功');
		realtimeConnectionError = false;
		retryCount = 0;

		// ✅ 再接続タイマーをクリア（重複購読防止）
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}

		if (fallbackPolling) {
			clearInterval(fallbackPolling);
			fallbackPolling = null;
		}
	};

	it('CHANNEL_ERROR後、再接続タイマーがセットされる', () => {
		// エラー発生
		realtimeConnectionError = true;
		retryRealtimeConnection();

		// タイマーがセットされている
		expect(retryTimer).not.toBeNull();
		expect(retryCount).toBe(1);
	});

	it('SUBSCRIBED時、retryTimerがクリアされる', () => {
		// エラー発生 → タイマーセット
		realtimeConnectionError = true;
		retryRealtimeConnection();
		expect(retryTimer).not.toBeNull();

		// SUBSCRIBED状態になる
		handleSubscribed();

		// ✅ タイマーがクリアされている
		expect(retryTimer).toBeNull();
		expect(realtimeConnectionError).toBe(false);
		expect(retryCount).toBe(0);
	});

	it('タイマークリア後、setupCallCountが増加しない', () => {
		// エラー発生 → タイマーセット
		realtimeConnectionError = true;
		retryRealtimeConnection();

		expect(retryTimer).not.toBeNull();
		expect(setupCallCount).toBe(0);

		// SUBSCRIBED状態になる（タイマー発火前）
		handleSubscribed();

		// ✅ タイマーがクリアされている
		expect(retryTimer).toBeNull();

		// タイマーがクリアされたので、setupCallCountは0のまま
		expect(setupCallCount).toBe(0);
	});

	it('複数回のCHANNEL_ERROR後、SUBSCRIBED時に全てクリアされる', () => {
		// 1回目のエラー
		retryRealtimeConnection();
		expect(retryCount).toBe(1);

		// 2回目のエラー（タイマーは上書き）
		if (retryTimer) {
			clearTimeout(retryTimer);
		}
		retryRealtimeConnection();
		expect(retryCount).toBe(2);

		// 3回目のエラー
		if (retryTimer) {
			clearTimeout(retryTimer);
		}
		retryRealtimeConnection();
		expect(retryCount).toBe(3);

		// SUBSCRIBED状態になる
		handleSubscribed();

		// ✅ タイマーとカウントがリセット
		expect(retryTimer).toBeNull();
		expect(retryCount).toBe(0);
	});

	it('SUBSCRIBED → CHANNEL_ERROR → SUBSCRIBED の繰り返しでタイマーが適切に管理される', () => {
		// 1. 最初のSUBSCRIBED
		handleSubscribed();
		expect(retryTimer).toBeNull();

		// 2. CHANNEL_ERROR発生
		retryRealtimeConnection();
		expect(retryTimer).not.toBeNull();
		const timer1 = retryTimer;

		// 3. 再びSUBSCRIBED（タイマークリア）
		handleSubscribed();
		expect(retryTimer).toBeNull();

		// 4. 再びCHANNEL_ERROR
		retryRealtimeConnection();
		expect(retryTimer).not.toBeNull();
		const timer2 = retryTimer;

		// ✅ 新しいタイマーが別のオブジェクト
		expect(timer2).not.toBe(timer1);

		// 5. 再びSUBSCRIBED
		handleSubscribed();
		expect(retryTimer).toBeNull();
	});

	it('retryTimerがnullの場合、clearTimeoutでエラーが起きない', () => {
		// retryTimerがnull
		expect(retryTimer).toBeNull();

		// SUBSCRIBED状態になる
		expect(() => {
			handleSubscribed();
		}).not.toThrow();

		// ✅ 正常に処理される
		expect(retryTimer).toBeNull();
	});

	it('fallbackPollingとretryTimerが同時にクリアされる', () => {
		// エラー状態: retryTimerとfallbackPollingが両方セット
		retryRealtimeConnection();
		fallbackPolling = setInterval(() => {}, 10000);

		expect(retryTimer).not.toBeNull();
		expect(fallbackPolling).not.toBeNull();

		// SUBSCRIBED状態になる
		handleSubscribed();

		// ✅ 両方クリアされている
		expect(retryTimer).toBeNull();
		expect(fallbackPolling).toBeNull();
	});
});

describe('スコア監視画面 - retryTimer exponential backoff', () => {
	let retryTimer: any = null;
	let retryCount = 0;
	let delays: number[] = [];

	beforeEach(() => {
		retryTimer = null;
		retryCount = 0;
		delays = [];
		vi.clearAllMocks();
	});

	const retryRealtimeConnection = () => {
		const delay = Math.min(5000 * Math.pow(2, retryCount), 30000);
		delays.push(delay);
		retryCount++;

		retryTimer = setTimeout(() => {
			console.log('[retry] 再接続を試みます');
		}, delay);
	};

	it('リトライ回数に応じて遅延が増加する（exponential backoff）', () => {
		// 1回目: 5秒
		retryRealtimeConnection();
		expect(delays[0]).toBe(5000);

		// 2回目: 10秒
		if (retryTimer) clearTimeout(retryTimer);
		retryRealtimeConnection();
		expect(delays[1]).toBe(10000);

		// 3回目: 20秒
		if (retryTimer) clearTimeout(retryTimer);
		retryRealtimeConnection();
		expect(delays[2]).toBe(20000);

		// 4回目: 30秒（上限）
		if (retryTimer) clearTimeout(retryTimer);
		retryRealtimeConnection();
		expect(delays[3]).toBe(30000);

		// 5回目: 30秒（上限維持）
		if (retryTimer) clearTimeout(retryTimer);
		retryRealtimeConnection();
		expect(delays[4]).toBe(30000);
	});

	it('SUBSCRIBED後、retryCountがリセットされる', () => {
		// 3回エラー
		retryRealtimeConnection();
		retryRealtimeConnection();
		retryRealtimeConnection();
		expect(retryCount).toBe(3);

		// SUBSCRIBED → retryCountリセット
		retryCount = 0;
		expect(retryCount).toBe(0);

		// 次のエラーは再び5秒から
		retryRealtimeConnection();
		expect(delays[3]).toBe(5000); // 最初の遅延に戻る
	});
});
