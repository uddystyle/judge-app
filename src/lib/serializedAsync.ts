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

export function createSerializedAsync(
	fn: () => Promise<void>,
	options?: {
		pendingDelayMs?: number;
		onError?: (error: unknown) => void;
	}
): SerializedAsyncHandle {
	const pendingDelayMs = options?.pendingDelayMs ?? 100;

	let isExecuting = false;
	let hasPending = false;
	let pendingTimer: ReturnType<typeof setTimeout> | null = null;

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

		try {
			isExecuting = true;
			hasPending = false;
			await fn();
		} catch (error) {
			options?.onError?.(error);
		} finally {
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
			hasPending = false;
			// Resolve any outstanding waiters so they don't hang
			flushWaiters();
		}
	};
}
