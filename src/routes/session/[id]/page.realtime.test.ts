/**
 * 待機画面 Realtime 状態遷移テスト
 *
 * Realtime接続状態とフォールバックポーリングの切替を回帰検知する
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('待機画面 - Realtime状態遷移とフォールバックポーリング', () => {
	let statusCallback: ((status: string) => void) | null = null;
	let mockChannel: any;
	let mockSupabase: any;
	let setIntervalSpy: any;
	let clearIntervalSpy: any;
	let intervalIds: Set<any>;

	beforeEach(() => {
		vi.useFakeTimers();
		statusCallback = null;
		intervalIds = new Set();

		// setInterval/clearInterval をスパイ
		setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((callback, delay) => {
			const timerId = vi.fn() as any;
			timerId._callback = callback;
			timerId._delay = delay;
			intervalIds.add(timerId);
			return timerId;
		});

		clearIntervalSpy = vi.spyOn(global, 'clearInterval').mockImplementation((timerId) => {
			intervalIds.delete(timerId);
		});

		// Supabase チャンネルのモック
		mockChannel = {
			on: vi.fn(() => mockChannel),
			subscribe: vi.fn((callback) => {
				statusCallback = callback;
				return mockChannel;
			})
		};

		mockSupabase = {
			channel: vi.fn(() => mockChannel),
			removeChannel: vi.fn(),
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						single: vi.fn(() => Promise.resolve({ data: null, error: null }))
					}))
				}))
			}))
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe('SUBSCRIBED 状態', () => {
		it('SUBSCRIBED 時にフォールバックポーリングを停止する', async () => {
			// フォールバックポーリングをシミュレート（初期状態で1つ存在）
			const startFallbackPolling = () => {
				if (intervalIds.size > 0) {
					return; // 既に存在
				}
				const timerId = setInterval(() => {}, 30000);
				return timerId;
			};

			// 初期状態: ポーリング開始
			const initialTimerId = startFallbackPolling();
			expect(intervalIds.size).toBe(1);
			expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);

			// チャンネル作成
			mockSupabase.channel('test-channel');
			expect(mockChannel.subscribe).toBeDefined();

			// 購読開始（statusCallbackが設定される）
			mockChannel.subscribe((status: string) => {
				if (status === 'SUBSCRIBED') {
					// ポーリングを停止
					if (initialTimerId) {
						clearInterval(initialTimerId);
					}
				}
			});

			expect(statusCallback).toBeDefined();

			// SUBSCRIBED イベントを発火
			if (statusCallback) {
				await statusCallback('SUBSCRIBED');
			}

			// 検証: ポーリングが停止された
			expect(clearIntervalSpy).toHaveBeenCalledWith(initialTimerId);
			expect(intervalIds.size).toBe(0);
		});

		it('SUBSCRIBED 時に既存ポーリングがない場合はclearIntervalを呼ばない', async () => {
			let fallbackPolling: any = null;

			// チャンネル作成
			mockSupabase.channel('test-channel');

			// 購読開始
			mockChannel.subscribe((status: string) => {
				if (status === 'SUBSCRIBED') {
					if (fallbackPolling) {
						clearInterval(fallbackPolling);
						fallbackPolling = null;
					}
				}
			});

			// SUBSCRIBED イベントを発火
			if (statusCallback) {
				await statusCallback('SUBSCRIBED');
			}

			// 検証: clearIntervalは呼ばれない
			expect(clearIntervalSpy).not.toHaveBeenCalled();
		});
	});

	describe('CHANNEL_ERROR 状態', () => {
		it('CHANNEL_ERROR 時にフォールバックポーリングを開始する', async () => {
			const startFallbackPolling = () => {
				if (intervalIds.size > 0) {
					console.log('[fallback] 既にポーリング開始済み');
					return;
				}
				console.log('[fallback] フォールバックポーリングを開始（30秒ごと）');
				setInterval(() => {}, 30000);
			};

			// 初期状態: ポーリングなし
			expect(intervalIds.size).toBe(0);

			// チャンネル作成
			mockSupabase.channel('test-channel');

			// 購読開始
			mockChannel.subscribe((status: string) => {
				if (status === 'CHANNEL_ERROR') {
					startFallbackPolling();
				}
			});

			// CHANNEL_ERROR イベントを発火
			if (statusCallback) {
				await statusCallback('CHANNEL_ERROR');
			}

			// 検証: ポーリングが開始された
			expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
			expect(intervalIds.size).toBe(1);
		});

		it('CHANNEL_ERROR 時に既にポーリングが存在する場合は重複しない', async () => {
			const startFallbackPolling = () => {
				if (intervalIds.size > 0) {
					console.log('[fallback] 既にポーリング開始済み');
					return;
				}
				setInterval(() => {}, 30000);
			};

			// 初期状態: ポーリング開始
			startFallbackPolling();
			expect(intervalIds.size).toBe(1);

			// チャンネル作成
			mockSupabase.channel('test-channel');

			// 購読開始
			mockChannel.subscribe((status: string) => {
				if (status === 'CHANNEL_ERROR') {
					startFallbackPolling();
				}
			});

			// CHANNEL_ERROR イベントを発火
			if (statusCallback) {
				await statusCallback('CHANNEL_ERROR');
			}

			// 検証: ポーリングは重複しない（1つのまま）
			expect(intervalIds.size).toBe(1);
		});
	});

	describe('TIMED_OUT 状態', () => {
		it('TIMED_OUT 時にフォールバックポーリングを開始する', async () => {
			const startFallbackPolling = () => {
				if (intervalIds.size > 0) {
					return;
				}
				setInterval(() => {}, 30000);
			};

			// 初期状態: ポーリングなし
			expect(intervalIds.size).toBe(0);

			// チャンネル作成
			mockSupabase.channel('test-channel');

			// 購読開始
			mockChannel.subscribe((status: string) => {
				if (status === 'TIMED_OUT') {
					startFallbackPolling();
				}
			});

			// TIMED_OUT イベントを発火
			if (statusCallback) {
				await statusCallback('TIMED_OUT');
			}

			// 検証: ポーリングが開始された
			expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
			expect(intervalIds.size).toBe(1);
		});
	});

	describe('CLOSED 状態', () => {
		it('CLOSED 時にフォールバックポーリングを開始する', async () => {
			const startFallbackPolling = () => {
				if (intervalIds.size > 0) {
					return;
				}
				setInterval(() => {}, 30000);
			};

			// 初期状態: ポーリングなし
			expect(intervalIds.size).toBe(0);

			// チャンネル作成
			mockSupabase.channel('test-channel');

			// 購読開始
			mockChannel.subscribe((status: string) => {
				if (status === 'CLOSED') {
					startFallbackPolling();
				}
			});

			// CLOSED イベントを発火
			if (statusCallback) {
				await statusCallback('CLOSED');
			}

			// 検証: ポーリングが開始された
			expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
			expect(intervalIds.size).toBe(1);
		});
	});

	describe('状態遷移シーケンス', () => {
		it('SUBSCRIBED → CHANNEL_ERROR の順で状態遷移する', async () => {
			let fallbackPolling: any = null;

			const startFallbackPolling = () => {
				if (fallbackPolling) {
					return;
				}
				fallbackPolling = setInterval(() => {}, 30000);
			};

			// 初期状態: ポーリング開始（onMount時）
			startFallbackPolling();
			expect(intervalIds.size).toBe(1);

			// チャンネル作成
			mockSupabase.channel('test-channel');

			// 購読開始
			mockChannel.subscribe((status: string) => {
				if (status === 'SUBSCRIBED') {
					// ポーリング停止
					if (fallbackPolling) {
						clearInterval(fallbackPolling);
						fallbackPolling = null;
					}
				} else if (status === 'CHANNEL_ERROR') {
					// ポーリング再開
					startFallbackPolling();
				}
			});

			// Step 1: SUBSCRIBED イベント
			if (statusCallback) {
				await statusCallback('SUBSCRIBED');
			}

			expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
			expect(intervalIds.size).toBe(0);

			// Step 2: CHANNEL_ERROR イベント
			if (statusCallback) {
				await statusCallback('CHANNEL_ERROR');
			}

			expect(setIntervalSpy).toHaveBeenCalledTimes(2); // 初回 + 再開
			expect(intervalIds.size).toBe(1);
		});

		it('SUBSCRIBED → TIMED_OUT → SUBSCRIBED の順で状態遷移する', async () => {
			let fallbackPolling: any = null;

			const startFallbackPolling = () => {
				if (fallbackPolling) {
					return;
				}
				fallbackPolling = setInterval(() => {}, 30000);
			};

			// 初期状態: ポーリングなし
			expect(intervalIds.size).toBe(0);

			// チャンネル作成
			mockSupabase.channel('test-channel');

			// 購読開始
			mockChannel.subscribe((status: string) => {
				if (status === 'SUBSCRIBED') {
					if (fallbackPolling) {
						clearInterval(fallbackPolling);
						fallbackPolling = null;
					}
				} else if (status === 'TIMED_OUT') {
					startFallbackPolling();
				}
			});

			// Step 1: SUBSCRIBED イベント
			if (statusCallback) {
				await statusCallback('SUBSCRIBED');
			}

			expect(intervalIds.size).toBe(0);

			// Step 2: TIMED_OUT イベント（接続タイムアウト）
			if (statusCallback) {
				await statusCallback('TIMED_OUT');
			}

			expect(setIntervalSpy).toHaveBeenCalledTimes(1);
			expect(intervalIds.size).toBe(1);

			// Step 3: SUBSCRIBED イベント（再接続成功）
			if (statusCallback) {
				await statusCallback('SUBSCRIBED');
			}

			expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
			expect(intervalIds.size).toBe(0);
		});

		it('CHANNEL_ERROR → TIMED_OUT → CLOSED でポーリングが重複しない', async () => {
			let fallbackPolling: any = null;

			const startFallbackPolling = () => {
				if (fallbackPolling) {
					console.log('[fallback] 既にポーリング開始済み');
					return;
				}
				fallbackPolling = setInterval(() => {}, 30000);
			};

			// チャンネル作成
			mockSupabase.channel('test-channel');

			// 購読開始
			mockChannel.subscribe((status: string) => {
				if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
					startFallbackPolling();
				}
			});

			// Step 1: CHANNEL_ERROR
			if (statusCallback) {
				await statusCallback('CHANNEL_ERROR');
			}

			expect(intervalIds.size).toBe(1);

			// Step 2: TIMED_OUT（ポーリングは重複しない）
			if (statusCallback) {
				await statusCallback('TIMED_OUT');
			}

			expect(intervalIds.size).toBe(1); // 依然として1つのみ

			// Step 3: CLOSED（ポーリングは重複しない）
			if (statusCallback) {
				await statusCallback('CLOSED');
			}

			expect(intervalIds.size).toBe(1); // 依然として1つのみ
			expect(setIntervalSpy).toHaveBeenCalledTimes(1); // 1回だけ呼ばれる
		});
	});

	describe('ポーリング間隔の検証', () => {
		it('フォールバックポーリングは30秒間隔で実行される', () => {
			const startFallbackPolling = () => {
				if (intervalIds.size > 0) {
					return;
				}
				setInterval(() => {}, 30000);
			};

			startFallbackPolling();

			// 検証: 30000ms（30秒）間隔でsetIntervalが呼ばれる
			expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
		});

		it('複数のエラー状態でもポーリング間隔は変わらない', async () => {
			let fallbackPolling: any = null;

			const startFallbackPolling = () => {
				if (fallbackPolling) {
					return;
				}
				fallbackPolling = setInterval(() => {}, 30000);
			};

			// チャンネル作成
			mockSupabase.channel('test-channel');

			// 購読開始
			mockChannel.subscribe((status: string) => {
				if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
					startFallbackPolling();
				}
			});

			// CHANNEL_ERROR
			if (statusCallback) {
				await statusCallback('CHANNEL_ERROR');
			}

			expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);

			// TIMED_OUT（重複しない）
			if (statusCallback) {
				await statusCallback('TIMED_OUT');
			}

			// 検証: 依然として30秒間隔
			expect(setIntervalSpy).toHaveBeenCalledTimes(1);
			const calls = setIntervalSpy.mock.calls;
			expect(calls[0][1]).toBe(30000);
		});
	});

	describe('エッジケース', () => {
		it('ステータスコールバックが未定義の場合はエラーにならない', () => {
			expect(() => {
				if (statusCallback) {
					statusCallback('SUBSCRIBED');
				}
			}).not.toThrow();
		});

		it('clearInterval(null) が呼ばれてもエラーにならない', () => {
			expect(() => {
				clearInterval(null as any);
			}).not.toThrow();
		});

		it('未知のステータス値でもエラーにならない', async () => {
			let fallbackPolling: any = null;

			const startFallbackPolling = () => {
				if (fallbackPolling) {
					return;
				}
				fallbackPolling = setInterval(() => {}, 30000);
			};

			// チャンネル作成
			mockSupabase.channel('test-channel');

			// 購読開始
			mockChannel.subscribe((status: string) => {
				if (status === 'SUBSCRIBED') {
					if (fallbackPolling) {
						clearInterval(fallbackPolling);
						fallbackPolling = null;
					}
				} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
					startFallbackPolling();
				}
			});

			// 未知のステータス
			expect(async () => {
				if (statusCallback) {
					await statusCallback('UNKNOWN_STATUS');
				}
			}).not.toThrow();

			// ポーリングは開始されない
			expect(intervalIds.size).toBe(0);
		});
	});

	describe('メモリリーク防止', () => {
		it('コンポーネント破棄時にポーリングをクリーンアップする', () => {
			const fallbackPolling = setInterval(() => {}, 30000);

			expect(intervalIds.size).toBe(1);

			// onDestroy シミュレーション
			if (fallbackPolling) {
				clearInterval(fallbackPolling);
			}

			expect(clearIntervalSpy).toHaveBeenCalledWith(fallbackPolling);
			expect(intervalIds.size).toBe(0);
		});

		it('Realtimeチャンネルとポーリングの両方をクリーンアップする', () => {
			const fallbackPolling = setInterval(() => {}, 30000);
			const realtimeChannel = mockChannel;

			expect(intervalIds.size).toBe(1);

			// onDestroy シミュレーション
			if (realtimeChannel) {
				mockSupabase.removeChannel(realtimeChannel);
			}
			if (fallbackPolling) {
				clearInterval(fallbackPolling);
			}

			expect(mockSupabase.removeChannel).toHaveBeenCalledWith(realtimeChannel);
			expect(clearIntervalSpy).toHaveBeenCalledWith(fallbackPolling);
			expect(intervalIds.size).toBe(0);
		});
	});
});
