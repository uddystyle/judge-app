/**
 * createSerializedAsync ユニットテスト
 *
 * 実際の排他制御ロジックを直接テストする。
 * 以前の擬似実装ベースのテストを置き換える。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSerializedAsync } from '../serializedAsync';

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createSerializedAsync', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('単一呼び出しが正常に実行される', async () => {
		let executed = false;
		const handle = createSerializedAsync(async () => {
			executed = true;
		});

		handle.run();
		await vi.advanceTimersByTimeAsync(1);

		expect(executed).toBe(true);
		expect(handle.isRunning()).toBe(false);

		handle.cleanup();
	});

	it('実行中の再呼び出しがペンディングとして処理される', async () => {
		let executionCount = 0;
		let resolveFirst: (() => void) | null = null;

		const handle = createSerializedAsync(async () => {
			executionCount++;
			await new Promise<void>((resolve) => {
				resolveFirst = resolve;
			});
		});

		// 1回目: 実行開始（ブロック中）
		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(executionCount).toBe(1);
		expect(handle.isRunning()).toBe(true);

		// 2回目: 実行中なのでペンディング
		handle.run();
		expect(executionCount).toBe(1); // まだ1回のまま

		// 1回目完了 → ペンディングが100ms後に実行される
		resolveFirst!();
		await vi.advanceTimersByTimeAsync(1);
		expect(handle.isRunning()).toBe(false);

		// ペンディング実行待ち
		await vi.advanceTimersByTimeAsync(100);
		expect(executionCount).toBe(2);

		// 2回目を完了させる
		resolveFirst!();
		await vi.advanceTimersByTimeAsync(1);

		handle.cleanup();
	});

	it('3回の同時呼び出しが2回の実行に統合される', async () => {
		let executionCount = 0;
		let resolvers: Array<() => void> = [];

		const handle = createSerializedAsync(async () => {
			executionCount++;
			await new Promise<void>((resolve) => {
				resolvers.push(resolve);
			});
		});

		// 3つの同時呼び出し
		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		handle.run(); // ペンディング
		handle.run(); // 既にペンディングなので統合

		expect(executionCount).toBe(1);

		// 1回目完了
		resolvers[0]();
		await vi.advanceTimersByTimeAsync(1);

		// ペンディング遅延後に2回目実行
		await vi.advanceTimersByTimeAsync(100);
		expect(executionCount).toBe(2);

		// 2回目完了
		resolvers[1]();
		await vi.advanceTimersByTimeAsync(101);

		// 3回目は統合されたため実行されない
		expect(executionCount).toBe(2);

		handle.cleanup();
	});

	it('実行完了後にisRunningがfalseになる', async () => {
		const handle = createSerializedAsync(async () => {
			// 即座に完了
		});

		handle.run();
		await vi.advanceTimersByTimeAsync(1);

		expect(handle.isRunning()).toBe(false);

		handle.cleanup();
	});

	it('エラー発生時もセマフォが解放される', async () => {
		let executionCount = 0;
		const onError = vi.fn();

		const handle = createSerializedAsync(
			async () => {
				executionCount++;
				if (executionCount === 1) {
					throw new Error('test error');
				}
			},
			{ onError }
		);

		// 1回目: エラーで失敗
		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(onError).toHaveBeenCalledOnce();
		expect(handle.isRunning()).toBe(false);

		// 2回目: セマフォが解放されているので実行可能
		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(executionCount).toBe(2);

		handle.cleanup();
	});

	it('エラー後でもペンディングリクエストが実行される', async () => {
		let executionCount = 0;
		let resolvers: Array<() => void> = [];

		const handle = createSerializedAsync(
			async () => {
				executionCount++;
				if (executionCount === 1) {
					throw new Error('first call fails');
				}
				await new Promise<void>((resolve) => {
					resolvers.push(resolve);
				});
			},
			{ onError: () => {} }
		);

		// 1回目実行開始（エラーで終了）
		handle.run();
		await vi.advanceTimersByTimeAsync(1);

		// 実行中にペンディングを登録…ではなく、エラーで即完了するので
		// 完了前にrunを呼ぶ必要がある。同期的に呼ぶ。
		// →　1回目がエラーで完了した後に2回目を呼ぶ
		handle.run();
		await vi.advanceTimersByTimeAsync(1);

		expect(executionCount).toBe(2);

		resolvers[0]();
		await vi.advanceTimersByTimeAsync(1);

		handle.cleanup();
	});

	it('cleanupがペンディングタイマーをキャンセルする', async () => {
		let executionCount = 0;
		let resolveFirst: (() => void) | null = null;

		const handle = createSerializedAsync(async () => {
			executionCount++;
			if (executionCount === 1) {
				await new Promise<void>((resolve) => {
					resolveFirst = resolve;
				});
			}
		});

		// 1回目実行
		handle.run();
		await vi.advanceTimersByTimeAsync(1);

		// ペンディング登録
		handle.run();

		// 1回目完了（ペンディングタイマー登録される）
		resolveFirst!();
		await vi.advanceTimersByTimeAsync(1);

		// cleanup前に: タイマーが登録されている
		handle.cleanup();

		// タイマー発火タイミングを過ぎても実行されない
		await vi.advanceTimersByTimeAsync(200);
		expect(executionCount).toBe(1);
	});

	it('pendingDelayMsをカスタマイズできる', async () => {
		let executionCount = 0;
		let resolvers: Array<() => void> = [];

		const handle = createSerializedAsync(
			async () => {
				executionCount++;
				await new Promise<void>((resolve) => {
					resolvers.push(resolve);
				});
			},
			{ pendingDelayMs: 50 }
		);

		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		handle.run(); // ペンディング

		// 1回目完了
		resolvers[0]();
		await vi.advanceTimersByTimeAsync(1);

		// 50ms前: まだ2回目は実行されていない
		await vi.advanceTimersByTimeAsync(40);
		expect(executionCount).toBe(1);

		// 50ms後: 2回目が実行される
		await vi.advanceTimersByTimeAsync(10);
		expect(executionCount).toBe(2);

		resolvers[1]();
		await vi.advanceTimersByTimeAsync(1);

		handle.cleanup();
	});

	it('Realtimeイベント + ポーリング + 手動更新の競合シナリオ', async () => {
		let executionCount = 0;
		let resolvers: Array<() => void> = [];

		const handle = createSerializedAsync(async () => {
			executionCount++;
			await new Promise<void>((resolve) => {
				resolvers.push(resolve);
			});
		});

		// 手動更新（実行開始）
		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(executionCount).toBe(1);

		// Realtimeイベント受信（ペンディング）
		handle.run();
		expect(executionCount).toBe(1);

		// フォールバックポーリング（既にペンディングなので統合）
		handle.run();
		expect(executionCount).toBe(1);

		// 手動更新完了
		resolvers[0]();
		await vi.advanceTimersByTimeAsync(1);

		// ペンディング実行
		await vi.advanceTimersByTimeAsync(100);
		expect(executionCount).toBe(2);

		// ペンディング完了
		resolvers[1]();
		await vi.advanceTimersByTimeAsync(101);

		// 統合されて2回のみ
		expect(executionCount).toBe(2);

		handle.cleanup();
	});

	it('runAsync()が実行完了まで待機する', async () => {
		let executed = false;
		const handle = createSerializedAsync(async () => {
			await delay(50);
			executed = true;
		});

		const promise = handle.runAsync();
		expect(executed).toBe(false);

		await vi.advanceTimersByTimeAsync(50);
		await promise;

		expect(executed).toBe(true);
		handle.cleanup();
	});

	it('runAsync()が実行中の場合、現在の実行+ペンディング完了まで待機する', async () => {
		let executionCount = 0;
		let resolvers: Array<() => void> = [];

		const handle = createSerializedAsync(async () => {
			executionCount++;
			await new Promise<void>((resolve) => {
				resolvers.push(resolve);
			});
		});

		// 1回目: fire-and-forget
		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(executionCount).toBe(1);

		// 2回目: runAsync — 実行中なのでpendingになり、完了を待つ
		let asyncResolved = false;
		const promise = handle.runAsync().then(() => {
			asyncResolved = true;
		});

		// 1回目完了 → pending実行がスケジュール
		resolvers[0]();
		await vi.advanceTimersByTimeAsync(1);
		expect(asyncResolved).toBe(false); // まだpending実行が残っている

		// pending遅延後に2回目実行
		await vi.advanceTimersByTimeAsync(100);
		expect(executionCount).toBe(2);

		// 2回目完了 → runAsync の Promise が resolve
		resolvers[1]();
		await vi.advanceTimersByTimeAsync(1);
		await promise;
		expect(asyncResolved).toBe(true);

		handle.cleanup();
	});

	it('runAsync()とrun()が排他制御を共有する', async () => {
		let executionCount = 0;
		let resolvers: Array<() => void> = [];

		const handle = createSerializedAsync(async () => {
			executionCount++;
			await new Promise<void>((resolve) => {
				resolvers.push(resolve);
			});
		});

		// runAsync で実行開始
		const promise = handle.runAsync();
		await vi.advanceTimersByTimeAsync(1);
		expect(executionCount).toBe(1);
		expect(handle.isRunning()).toBe(true);

		// run() は pending になる（並行実行しない）
		handle.run();
		expect(executionCount).toBe(1);

		// 1回目完了
		resolvers[0]();
		await vi.advanceTimersByTimeAsync(1);

		// pending 遅延後に2回目実行
		await vi.advanceTimersByTimeAsync(100);
		expect(executionCount).toBe(2);

		// 2回目完了 → promise resolve
		resolvers[1]();
		await vi.advanceTimersByTimeAsync(1);
		await promise;

		handle.cleanup();
	});

	it('cleanup()がrunAsync()のwaitersを解放する', async () => {
		const handle = createSerializedAsync(async () => {
			await delay(1000); // 長い処理
		});

		// runAsync 開始（完了前に cleanup される）
		let resolved = false;
		const promise = handle.runAsync().then(() => {
			resolved = true;
		});

		// cleanup → waiter が即座に resolve される（ハングしない）
		handle.cleanup();
		await vi.advanceTimersByTimeAsync(1);
		await promise;
		expect(resolved).toBe(true);
	});

	it('連続したrun呼び出しでタイマーが多重登録されない', async () => {
		let executionCount = 0;
		let resolvers: Array<() => void> = [];

		const handle = createSerializedAsync(async () => {
			executionCount++;
			await new Promise<void>((resolve) => {
				resolvers.push(resolve);
			});
		});

		// 1回目実行
		handle.run();
		await vi.advanceTimersByTimeAsync(1);

		// 5回連続でペンディング登録
		for (let i = 0; i < 5; i++) {
			handle.run();
		}

		// 1回目完了
		resolvers[0]();
		await vi.advanceTimersByTimeAsync(1);

		// ペンディング発火
		await vi.advanceTimersByTimeAsync(100);
		expect(executionCount).toBe(2); // 1回だけ追加実行

		// 2回目完了
		resolvers[1]();
		await vi.advanceTimersByTimeAsync(101);

		// それ以上実行されない
		expect(executionCount).toBe(2);

		handle.cleanup();
	});
});

/**
 * リクエスト期限
 *
 * ⚠️ 以前は fn() が解決するまで isExecuting が立ちっぱなしで、後続呼び出しは
 * hasPending を立てて即 return するだけだった。PostgREST が一度ハングすると
 * **その画面のポーリングが以後まったく実行されなくなる**（realtime.ts の
 * ヘルスポーリングもこの機構を使っている）。現場では復旧手段が「再読み込み」しかない。
 *
 * fn 側が期限を守れなくても、直列化の錠だけは必ず解放されなければならない。
 */
describe('createSerializedAsync のリクエスト期限', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('fn がハングしても期限で錠が解放され、次の実行が走る', async () => {
		let calls = 0;
		// 1回目は永久にハングする
		const handle = createSerializedAsync(
			() => {
				calls++;
				return calls === 1 ? new Promise<void>(() => {}) : Promise.resolve();
			},
			{ pendingDelayMs: 0, timeoutMs: 5000 }
		);

		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toBe(1);

		// 期限前は錠がかかったまま（重複実行しない）
		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toBe(1);

		// 期限を過ぎたら錠が解放され、保留していた分が**自動で**走る
		// （ポーリングが自力で再開する。利用者が再度叩く必要はない）
		await vi.advanceTimersByTimeAsync(5000);
		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toBe(2);

		// 以後も通常どおり実行できる
		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toBe(3);
	});

	it('期限切れは onError で通知される（沈黙させない）', async () => {
		const onError = vi.fn();
		const handle = createSerializedAsync(() => new Promise<void>(() => {}), {
			pendingDelayMs: 0,
			timeoutMs: 3000,
			onError
		});

		handle.run();
		await vi.advanceTimersByTimeAsync(3000);

		expect(onError).toHaveBeenCalled();
	});

	it('fn には AbortSignal が渡され、期限切れで abort される', async () => {
		let signal: AbortSignal | undefined;
		const handle = createSerializedAsync(
			(s) => {
				signal = s;
				return new Promise<void>(() => {});
			},
			{ pendingDelayMs: 0, timeoutMs: 2000 }
		);

		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(signal!.aborted).toBe(false);

		await vi.advanceTimersByTimeAsync(2000);
		expect(signal!.aborted).toBe(true);
	});

	it('cleanup で実行中の signal が abort される（画面離脱時に握ったままにしない）', async () => {
		let signal: AbortSignal | undefined;
		const handle = createSerializedAsync(
			(s) => {
				signal = s;
				return new Promise<void>(() => {});
			},
			{ pendingDelayMs: 0, timeoutMs: 60000 }
		);

		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(signal!.aborted).toBe(false);

		handle.cleanup();
		expect(signal!.aborted).toBe(true);
	});

	it('timeoutMs 未指定なら従来どおり期限なしで動く（既定の互換）', async () => {
		let resolveFn: (() => void) | undefined;
		let calls = 0;
		const handle = createSerializedAsync(() => {
			calls++;
			return new Promise<void>((r) => {
				resolveFn = r;
			});
		});

		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toBe(1);

		// 長時間経っても勝手に解放しない
		await vi.advanceTimersByTimeAsync(600000);
		handle.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toBe(1);

		resolveFn!();
		await vi.advanceTimersByTimeAsync(1);
	});
});
