import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

const DEFAULT_MAX_RETRY = 5;
const DEFAULT_POLLING_INTERVAL_MS = 10000;

/** Status values that indicate the channel is no longer functional. */
function isErrorStatus(status: string): boolean {
	return status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED';
}

export interface RealtimeChannelConfig {
	channelName: string;
	table: string;
	schema?: string;
	event?: string; // default '*'
	filter: string;
	onPayload: (payload: any) => void;
	/** Bounded exponential-backoff resubscribe attempts before giving up. Default 5. */
	maxRetryCount?: number;
}

export interface RealtimeChannelHandle {
	cleanup: () => void;
	getChannel: () => RealtimeChannel | null;
}

export interface RealtimeChannelWithRetryConfig extends RealtimeChannelConfig {
	// maxRetryCount は RealtimeChannelConfig から継承
	pollingIntervalMs?: number;
	pollingFn: () => Promise<void>;
	onConnectionError?: (hasError: boolean) => void;
}

export interface RealtimeChannelWithRetryHandle extends RealtimeChannelHandle {
	manualRefresh: (refreshFn?: () => Promise<void>) => Promise<void>;
	hasConnectionError: () => boolean;
}

/**
 * Simple realtime channel subscription.
 * Use for scoreboards and other simple monitoring cases.
 */
export function createRealtimeChannel(
	supabase: SupabaseClient,
	config: RealtimeChannelConfig
): RealtimeChannelHandle {
	const maxRetryCount = config.maxRetryCount ?? DEFAULT_MAX_RETRY;
	let channel: RealtimeChannel | null = null;
	let retryCount = 0;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;

	function retryConnection() {
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		if (retryCount >= maxRetryCount) {
			console.error(
				`[realtime/${config.channelName}] max retries (${maxRetryCount}) reached, giving up`
			);
			return;
		}
		const backoffDelay = Math.pow(2, retryCount) * 1000;
		retryCount++;
		console.log(
			`[realtime/${config.channelName}] retry ${retryCount}/${maxRetryCount} in ${backoffDelay}ms`
		);
		retryTimer = setTimeout(() => {
			if (channel) {
				supabase.removeChannel(channel);
				channel = null;
			}
			setupChannel();
		}, backoffDelay);
	}

	function setupChannel() {
		channel = supabase
			.channel(config.channelName)
			.on(
				'postgres_changes',
				{
					event: (config.event || '*') as any,
					schema: config.schema || 'public',
					table: config.table,
					filter: config.filter
				},
				(payload: any) => {
					config.onPayload(payload);
				}
			)
			.subscribe((status: string) => {
				console.log(`[realtime/${config.channelName}] status:`, status);
				if (status === 'SUBSCRIBED') {
					console.log(`[realtime/${config.channelName}] connected`);
					// 接続成功でリトライ状態をリセット（再購読の上限を使い果たさない）。
					retryCount = 0;
					if (retryTimer) {
						clearTimeout(retryTimer);
						retryTimer = null;
					}
				} else if (isErrorStatus(status)) {
					console.error(`[realtime/${config.channelName}] error:`, status);
					// 現状 no-op だったところを、上限つきバックオフ再購読に。
					retryConnection();
				}
			});
	}

	setupChannel();

	return {
		cleanup: () => {
			if (retryTimer) {
				clearTimeout(retryTimer);
				retryTimer = null;
			}
			if (channel) {
				supabase.removeChannel(channel);
				channel = null;
			}
		},
		getChannel: () => channel
	};
}

/**
 * Realtime channel with exponential backoff retry and fallback polling.
 * Use for score status monitoring pages that need high reliability.
 */
export function createRealtimeChannelWithRetry(
	supabase: SupabaseClient,
	config: RealtimeChannelWithRetryConfig
): RealtimeChannelWithRetryHandle {
	const maxRetryCount = config.maxRetryCount ?? DEFAULT_MAX_RETRY;
	const pollingIntervalMs = config.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;

	let channel: RealtimeChannel | null = null;
	let retryCount = 0;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	let fallbackPolling: ReturnType<typeof setInterval> | null = null;
	let connectionError = false;

	function startFallbackPolling() {
		if (fallbackPolling) return;

		console.log(
			`[realtime/${config.channelName}] fallback polling started (${pollingIntervalMs}ms)`
		);
		fallbackPolling = setInterval(async () => {
			await config.pollingFn();
		}, pollingIntervalMs);
	}

	function stopFallbackPolling() {
		if (fallbackPolling) {
			clearInterval(fallbackPolling);
			fallbackPolling = null;
		}
	}

	function retryConnection() {
		// Clear existing timer to prevent duplicate subscriptions
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}

		if (retryCount >= maxRetryCount) {
			console.error(
				`[realtime/${config.channelName}] max retries (${maxRetryCount}) reached, switching to fallback polling`
			);
			connectionError = true;
			config.onConnectionError?.(true);
			startFallbackPolling();
			return;
		}

		const backoffDelay = Math.pow(2, retryCount) * 1000;
		retryCount++;
		console.log(
			`[realtime/${config.channelName}] retry ${retryCount}/${maxRetryCount} in ${backoffDelay}ms`
		);

		retryTimer = setTimeout(() => {
			if (channel) {
				supabase.removeChannel(channel);
				channel = null;
			}
			setupChannel();
		}, backoffDelay);
	}

	function setupChannel() {
		channel = supabase
			.channel(config.channelName)
			.on(
				'postgres_changes',
				{
					event: (config.event || '*') as any,
					schema: config.schema || 'public',
					table: config.table,
					filter: config.filter
				},
				(payload: any) => {
					config.onPayload(payload);
				}
			)
			.subscribe((status: string) => {
				console.log(`[realtime/${config.channelName}] status:`, status);
				if (status === 'SUBSCRIBED') {
					console.log(`[realtime/${config.channelName}] connected`);
					connectionError = false;
					retryCount = 0;
					config.onConnectionError?.(false);

					// Clear retry timer to prevent duplicate subscriptions
					if (retryTimer) {
						clearTimeout(retryTimer);
						retryTimer = null;
					}

					// Stop fallback polling when realtime is connected
					stopFallbackPolling();
				} else if (isErrorStatus(status)) {
					console.error(`[realtime/${config.channelName}] error:`, status);
					connectionError = true;
					config.onConnectionError?.(true);
					retryConnection();
				}
			});
	}

	// Start the channel
	setupChannel();

	return {
		cleanup: () => {
			if (channel) {
				supabase.removeChannel(channel);
				channel = null;
			}
			if (retryTimer) {
				clearTimeout(retryTimer);
				retryTimer = null;
			}
			stopFallbackPolling();
		},
		getChannel: () => channel,
		hasConnectionError: () => connectionError,
		manualRefresh: async (refreshFn?: () => Promise<void>) => {
			// Clear pending retry timer to prevent duplicate setupChannel() calls
			if (retryTimer) {
				clearTimeout(retryTimer);
				retryTimer = null;
			}

			connectionError = false;
			retryCount = 0;
			config.onConnectionError?.(false);

			stopFallbackPolling();

			if (refreshFn) {
				await refreshFn();
			} else {
				await config.pollingFn();
			}

			// Reconnect immediately
			if (channel) {
				supabase.removeChannel(channel);
				channel = null;
			}
			setupChannel();
		}
	};
}

/**
 * Simple session monitoring channel.
 * On error, reloads the page after a delay.
 * Use for status and complete pages that need to watch session state changes.
 */
export function createSessionMonitorChannel(
	supabase: SupabaseClient,
	config: {
		sessionId: string;
		channelPrefix?: string;
		maxRetryCount?: number;
		onPayload: (payload: any) => void;
		onError?: () => void;
	}
): RealtimeChannelHandle {
	const prefix = config.channelPrefix || 'session-monitor';
	const channelName = `${prefix}-${config.sessionId}`;
	const maxRetryCount = config.maxRetryCount ?? DEFAULT_MAX_RETRY;
	let channel: RealtimeChannel | null = null;
	let retryCount = 0;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	let errorReloadTimer: ReturnType<typeof setTimeout> | null = null;

	function clearTimers() {
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		if (errorReloadTimer) {
			clearTimeout(errorReloadTimer);
			errorReloadTimer = null;
		}
	}

	// 上限つき再購読を使い果たした後の最終手段（状態の取り直し）。
	function terminalFallback() {
		if (config.onError) {
			config.onError();
		} else {
			if (errorReloadTimer) clearTimeout(errorReloadTimer);
			errorReloadTimer = setTimeout(() => {
				if (channel) {
					supabase.removeChannel(channel);
					channel = null;
				}
				window.location.reload();
			}, 2000);
		}
	}

	function retryConnection() {
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		if (retryCount >= maxRetryCount) {
			console.error(
				`[realtime/${channelName}] max retries (${maxRetryCount}) reached, falling back`
			);
			terminalFallback();
			return;
		}
		const backoffDelay = Math.pow(2, retryCount) * 1000;
		retryCount++;
		console.log(
			`[realtime/${channelName}] retry ${retryCount}/${maxRetryCount} in ${backoffDelay}ms`
		);
		retryTimer = setTimeout(() => {
			if (channel) {
				supabase.removeChannel(channel);
				channel = null;
			}
			setupChannel();
		}, backoffDelay);
	}

	function setupChannel() {
		channel = supabase
			.channel(channelName)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE' as any,
					schema: 'public',
					table: 'sessions',
					filter: `id=eq.${config.sessionId}`
				},
				(payload: any) => {
					config.onPayload(payload);
				}
			)
			.subscribe((status: string) => {
				console.log(`[realtime/${channelName}] status:`, status);
				if (status === 'SUBSCRIBED') {
					console.log(`[realtime/${channelName}] connected`);
					// 接続成功・再接続復帰: リトライと最終手段(reload)をリセット。
					retryCount = 0;
					clearTimers();
				} else if (isErrorStatus(status)) {
					console.error(`[realtime/${channelName}] error:`, status);
					// 即 reload せず、まず上限つきバックオフ再購読。使い切ったら最終手段。
					retryConnection();
				}
			});
	}

	setupChannel();

	return {
		cleanup: () => {
			clearTimers();
			if (channel) {
				supabase.removeChannel(channel);
				channel = null;
			}
		},
		getChannel: () => channel
	};
}

/**
 * Session monitoring with fallback polling backup.
 * Use for complete pages where realtime monitors session + 3s polling as backup.
 */
export function createSessionMonitorWithPolling(
	supabase: SupabaseClient,
	config: {
		sessionId: string;
		channelPrefix?: string;
		maxRetryCount?: number;
		pollingIntervalMs?: number;
		onRealtimePayload: (payload: any) => void;
		onPollingData: (data: { is_active: boolean; active_prompt_id: string | null }) => void;
		onError?: () => void;
	}
): RealtimeChannelHandle {
	const prefix = config.channelPrefix || 'session-end';
	const channelName = `${prefix}-${config.sessionId}`;
	const pollingMs = config.pollingIntervalMs ?? 3000;
	const maxRetryCount = config.maxRetryCount ?? DEFAULT_MAX_RETRY;
	let channel: RealtimeChannel | null = null;
	let pollingInterval: ReturnType<typeof setInterval> | null = null;
	let retryCount = 0;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	let errorReloadTimer: ReturnType<typeof setTimeout> | null = null;

	function stopPolling() {
		if (pollingInterval) {
			clearInterval(pollingInterval);
			pollingInterval = null;
		}
	}

	function startPolling() {
		stopPolling();
		pollingInterval = setInterval(async () => {
			const { data, error } = await supabase
				.from('sessions')
				.select('is_active, active_prompt_id')
				.eq('id', config.sessionId)
				.single();

			if (!error && data) {
				config.onPollingData(data as any);
			}
		}, pollingMs);
	}

	function clearRetryTimer() {
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
	}

	// 上限つき再購読を使い果たした後の最終手段。
	function terminalFallback() {
		if (config.onError) {
			config.onError();
		} else {
			if (errorReloadTimer) clearTimeout(errorReloadTimer);
			errorReloadTimer = setTimeout(() => {
				if (channel) {
					supabase.removeChannel(channel);
					channel = null;
				}
				window.location.reload();
			}, 2000);
		}
	}

	function retryConnection() {
		clearRetryTimer();
		if (retryCount >= maxRetryCount) {
			console.error(
				`[realtime/${channelName}] max retries (${maxRetryCount}) reached, falling back`
			);
			terminalFallback();
			return;
		}
		const backoffDelay = Math.pow(2, retryCount) * 1000;
		retryCount++;
		console.log(
			`[realtime/${channelName}] retry ${retryCount}/${maxRetryCount} in ${backoffDelay}ms`
		);
		retryTimer = setTimeout(() => {
			if (channel) {
				supabase.removeChannel(channel);
				channel = null;
			}
			setupChannel();
		}, backoffDelay);
	}

	function setupChannel() {
		channel = supabase
			.channel(channelName)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE' as any,
					schema: 'public',
					table: 'sessions',
					filter: `id=eq.${config.sessionId}`
				},
				(payload: any) => {
					config.onRealtimePayload(payload);
				}
			)
			.subscribe((status: string) => {
				console.log(`[realtime/${channelName}] status:`, status);
				if (status === 'SUBSCRIBED') {
					console.log(`[realtime/${channelName}] connected`);

					// 接続成功・再接続復帰: リトライと最終手段(reload)をリセット。
					retryCount = 0;
					clearRetryTimer();
					if (errorReloadTimer) {
						clearTimeout(errorReloadTimer);
						errorReloadTimer = null;
					}

					// Supabase は SUBSCRIBED を複数回発火しうる（再接続）。startPolling() は
					// 既存intervalをclearしてから張り直すので多重化しない。
					startPolling();
				} else if (isErrorStatus(status)) {
					console.error(`[realtime/${channelName}] error:`, status);
					// ポーリングは止めない（再購読中の取りこぼしを防ぐ保険として走らせ続ける）。
					// 即 reload せず、まず上限つきバックオフ再購読。使い切ったら最終手段。
					retryConnection();
				}
			});
	}

	setupChannel();

	return {
		cleanup: () => {
			clearRetryTimer();
			if (errorReloadTimer) {
				clearTimeout(errorReloadTimer);
				errorReloadTimer = null;
			}
			if (channel) {
				supabase.removeChannel(channel);
				channel = null;
			}
			stopPolling();
		},
		getChannel: () => channel
	};
}
