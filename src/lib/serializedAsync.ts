/**
 * Serialized async execution with pending request coalescing.
 *
 * Ensures that only one instance of the wrapped function runs at a time.
 * If called while already executing, the request is marked as pending.
 * When the current execution finishes, one pending request is executed
 * (coalescing multiple pending calls into a single execution).
 */
export interface SerializedAsyncHandle {
	/** Execute the function, or mark as pending if already running */
	run: () => void;
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
			}
		}
	}

	return {
		run: () => {
			execute();
		},
		isRunning: () => isExecuting,
		cleanup: () => {
			if (pendingTimer) {
				clearTimeout(pendingTimer);
				pendingTimer = null;
			}
			hasPending = false;
		}
	};
}
