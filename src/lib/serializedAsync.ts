/**
 * Serialized async execution with pending request coalescing.
 *
 * Ensures that only one instance of the wrapped function runs at a time.
 * If called while already executing, the request is marked as pending.
 * When the current execution finishes, one pending request is executed
 * (coalescing multiple pending calls into a single execution).
 */
export interface SerializedAsyncHandle {
	/** Execute the function (fire-and-forget), or mark as pending if already running */
	run: () => void;
	/**
	 * Execute the function and return a Promise that resolves when the
	 * execution completes. If already running, waits for the current
	 * execution (plus the coalesced pending run) to finish.
	 */
	runAsync: () => Promise<void>;
	/** Whether the function is currently executing */
	isRunning: () => boolean;
	/** Dispose of pending timers */
	cleanup: () => void;
}

/**
 * ポーリング系の既定の期限。
 *
 * 「錠を持つ機構には必ず期限を持たせる」という方針の既定値。
 * 個別に事情がある場合だけ timeoutMs で上書きする。
 * 会場の低速回線でも通る余裕を見た値で、超えたら錠を解放して次の周期へ進む。
 */
export const DEFAULT_POLL_TIMEOUT_MS = 15000;

export class SerializedAsyncTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`serialized async execution exceeded ${timeoutMs}ms`);
		this.name = 'SerializedAsyncTimeoutError';
	}
}

export function createSerializedAsync(
	fn: (signal?: AbortSignal) => Promise<void>,
	options?: {
		pendingDelayMs?: number;
		onError?: (error: unknown) => void;
		/**
		 * 1回の実行に許す上限。超えたら**錠だけ解放**して後続を動かす。
		 *
		 * ⚠️ これが無いと、fn が解決しない限り isExecuting が立ちっぱなしになり、
		 * 後続の呼び出しは hasPending を立てて即 return するだけになる。
		 * PostgREST が一度ハングすると、その画面のポーリングが以後まったく
		 * 実行されなくなる（復旧手段が再読み込みしかない）。
		 *
		 * 期限切れでも元の Promise は握り潰さず、AbortSignal で中断を通知する。
		 * fn 側が signal を尊重すれば実際の通信も止まる（supabase-js は
		 * `.abortSignal()`、fetch は `signal` を受ける）。
		 * 未指定なら期限なし（従来の挙動）。
		 *
		 * ⚠️ **`timeoutMs` を付けた時点で「常に1件だけ実行」は無条件には成り立たない。**
		 * 期限で錠を解放しても、fn が signal を尊重しなければ元の処理は走り続けるため、
		 * 次の実行と重複する。「直列化されている」前提で新しい処理を載せる前に、
		 * その fn が signal を末端まで通しているかを必ず確認すること
		 * （abort できない API を使う例: SvelteKit の invalidateAll → scoreboardRefresh.ts）。
		 */
		timeoutMs?: number;
	}
): SerializedAsyncHandle {
	const pendingDelayMs = options?.pendingDelayMs ?? 100;
	const timeoutMs = options?.timeoutMs;

	let isExecuting = false;
	let hasPending = false;
	let pendingTimer: ReturnType<typeof setTimeout> | null = null;
	let activeController: AbortController | null = null;

	// Waiters that need to be notified when the current cycle completes.
	// A "cycle" is the current execution plus any coalesced pending run.
	let waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

	function flushWaiters(error?: unknown) {
		const current = waiters;
		waiters = [];
		for (const w of current) {
			if (error) {
				w.reject(error);
			} else {
				w.resolve();
			}
		}
	}

	async function execute() {
		if (isExecuting) {
			hasPending = true;
			return;
		}

		const controller = new AbortController();
		activeController = controller;
		let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

		try {
			isExecuting = true;
			hasPending = false;

			if (timeoutMs === undefined) {
				await fn(controller.signal);
			} else {
				// 期限で負けたら錠を解放する。元の Promise は捨てるが、
				// 後で解決/失敗しても未処理拒否にならないよう握っておく。
				const running = fn(controller.signal);
				void running.catch(() => {});
				await Promise.race([
					running,
					new Promise<never>((_, reject) => {
						timeoutTimer = setTimeout(() => {
							controller.abort();
							reject(new SerializedAsyncTimeoutError(timeoutMs));
						}, timeoutMs);
					})
				]);
			}
		} catch (error) {
			options?.onError?.(error);
		} finally {
			if (timeoutTimer) clearTimeout(timeoutTimer);
			if (activeController === controller) activeController = null;
			isExecuting = false;

			if (hasPending) {
				hasPending = false;
				pendingTimer = setTimeout(() => {
					pendingTimer = null;
					execute();
				}, pendingDelayMs);
			} else {
				// No more pending work — resolve all waiters
				flushWaiters();
			}
		}
	}

	return {
		run: () => {
			execute();
		},
		runAsync: () => {
			return new Promise<void>((resolve, reject) => {
				waiters.push({ resolve, reject });
				execute();
			});
		},
		isRunning: () => isExecuting,
		cleanup: () => {
			if (pendingTimer) {
				clearTimeout(pendingTimer);
				pendingTimer = null;
			}
			// 画面離脱時に実行中の通信を握ったままにしない
			activeController?.abort();
			activeController = null;
			hasPending = false;
			// Resolve any outstanding waiters so they don't hang
			flushWaiters();
		}
	};
}
