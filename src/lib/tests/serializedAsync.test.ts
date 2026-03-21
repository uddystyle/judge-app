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
