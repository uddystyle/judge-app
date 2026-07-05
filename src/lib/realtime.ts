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
	/** 省略時はテーブル全体を購読 */
	filter?: string;
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
	/** SUBSCRIBED 時の追加処理（リトライ状態リセット・ポーリング停止の後に呼ばれる） */
	onSubscribed?: () => void;
	/** true なら購読確立を待たずに直ちにフォールバックポーリングを開始する（取りこぼし対策） */
	startPollingImmediately?: boolean;
	/** true ならエラーステータス検知時点でポーリングを開始する（リトライ上限を待たない） */
	startPollingOnErrorStatus?: boolean;
}

export interface RealtimeChannelWithRetryHandle extends RealtimeChannelHandle {
	manualRefresh: (refreshFn?: () => Promise<void>) => Promise<void>;
	hasConnectionError: () => boolean;
}

// ============================================================
// 内部コア: 上限つき指数バックオフ再購読を持つチャンネル管理
// 4つの公開ファクトリはすべてこのコアの薄いラッパー
// ============================================================

interface ManagedChannelOptions {
	channelName: string;
	table: string;
	schema?: string;
	event?: string; // default '*'
	filter?: string;
	maxRetryCount: number;
	onPayload: (payload: any) => void;
	/** SUBSCRIBED 時の追加処理（コアが retryCount リセット・retryTimer クリアを済ませた後） */
	onSubscribed?: () => void;
	/** エラーステータス時の追加処理（バックオフ再購読の前） */
	onErrorStatus?: () => void;
	/** 再購読上限到達時の最終手段（ログ出力も呼び出し側の責務） */
	onMaxRetriesExhausted: () => void;
}

interface ManagedChannelHandle {
	cleanup: () => void;
	getChannel: () => RealtimeChannel | null;
	/** 保留中のバックオフ再購読をキャンセルし、リトライ状態をリセットする */
	cancelRetry: () => void;
	/** チャンネルを張り直す（リトライ状態もリセット） */
	reconnect: () => void;
}

function createManagedChannel(
	supabase: SupabaseClient,
	opts: ManagedChannelOptions
): ManagedChannelHandle {
	let channel: RealtimeChannel | null = null;
	let retryCount = 0;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;

	function clearRetryTimer() {
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
	}

	function removeChannel() {
		if (channel) {
			supabase.removeChannel(channel);
			channel = null;
		}
	}

	function retryConnection() {
		// 既存タイマーをクリアして重複購読を防ぐ
		clearRetryTimer();

		if (retryCount >= opts.maxRetryCount) {
			opts.onMaxRetriesExhausted();
			return;
		}

		const backoffDelay = Math.pow(2, retryCount) * 1000;
		retryCount++;
		console.log(
			`[realtime/${opts.channelName}] retry ${retryCount}/${opts.maxRetryCount} in ${backoffDelay}ms`
		);

		retryTimer = setTimeout(() => {
			removeChannel();
			setupChannel();
		}, backoffDelay);
	}

	function setupChannel() {
		channel = supabase
			.channel(opts.channelName)
			.on(
				'postgres_changes',
				{
					event: (opts.event || '*') as any,
					schema: opts.schema || 'public',
					table: opts.table,
					filter: opts.filter
				},
				(payload: any) => {
					opts.onPayload(payload);
				}
			)
			.subscribe((status: string) => {
				console.log(`[realtime/${opts.channelName}] status:`, status);
				if (status === 'SUBSCRIBED') {
					console.log(`[realtime/${opts.channelName}] connected`);
					// 接続成功でリトライ状態をリセット（再購読の上限を使い果たさない）
					retryCount = 0;
					clearRetryTimer();
					opts.onSubscribed?.();
				} else if (isErrorStatus(status)) {
					console.error(`[realtime/${opts.channelName}] error:`, status);
					opts.onErrorStatus?.();
					// 即諦めず、上限つきバックオフ再購読
					retryConnection();
				}
			});
	}

	setupChannel();

	return {
		cleanup: () => {
			clearRetryTimer();
			removeChannel();
		},
		getChannel: () => channel,
		cancelRetry: () => {
			clearRetryTimer();
			retryCount = 0;
		},
		reconnect: () => {
			clearRetryTimer();
			retryCount = 0;
			removeChannel();
			setupChannel();
		}
	};
}

// ============================================================
// 公開ファクトリ
// ============================================================

/**
 * Simple realtime channel subscription.
 * Use for scoreboards and other simple monitoring cases.
 */
export function createRealtimeChannel(
	supabase: SupabaseClient,
	config: RealtimeChannelConfig
): RealtimeChannelHandle {
	const maxRetryCount = config.maxRetryCount ?? DEFAULT_MAX_RETRY;

	const core = createManagedChannel(supabase, {
		channelName: config.channelName,
		table: config.table,
		schema: config.schema,
		event: config.event,
		filter: config.filter,
		maxRetryCount,
		onPayload: config.onPayload,
		onMaxRetriesExhausted: () => {
			console.error(
				`[realtime/${config.channelName}] max retries (${maxRetryCount}) reached, giving up`
			);
		}
	});

	return {
		cleanup: core.cleanup,
		getChannel: core.getChannel
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

	const core = createManagedChannel(supabase, {
		channelName: config.channelName,
		table: config.table,
		schema: config.schema,
		event: config.event,
		filter: config.filter,
		maxRetryCount,
		onPayload: config.onPayload,
		onSubscribed: () => {
			connectionError = false;
			config.onConnectionError?.(false);
			// realtime 接続中はフォールバックポーリング不要
			stopFallbackPolling();
			config.onSubscribed?.();
		},
		onErrorStatus: () => {
			connectionError = true;
			config.onConnectionError?.(true);
			if (config.startPollingOnErrorStatus) {
				startFallbackPolling();
			}
		},
		onMaxRetriesExhausted: () => {
			console.error(
				`[realtime/${config.channelName}] max retries (${maxRetryCount}) reached, switching to fallback polling`
			);
			connectionError = true;
			config.onConnectionError?.(true);
			startFallbackPolling();
		}
	});

	// 取りこぼし対策: 購読確立を待たずにポーリングを開始（SUBSCRIBED で停止する）
	if (config.startPollingImmediately) {
		startFallbackPolling();
	}

	return {
		cleanup: () => {
			core.cleanup();
			stopFallbackPolling();
		},
		getChannel: core.getChannel,
		hasConnectionError: () => connectionError,
		manualRefresh: async (refreshFn?: () => Promise<void>) => {
			// 保留中のバックオフ再購読をキャンセルして重複 setupChannel を防ぐ
			core.cancelRetry();

			connectionError = false;
			config.onConnectionError?.(false);

			stopFallbackPolling();

			if (refreshFn) {
				await refreshFn();
			} else {
				await config.pollingFn();
			}

			// Reconnect immediately
			core.reconnect();
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
	let errorReloadTimer: ReturnType<typeof setTimeout> | null = null;

	function clearErrorReloadTimer() {
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
			clearErrorReloadTimer();
			errorReloadTimer = setTimeout(() => {
				core.cleanup();
				window.location.reload();
			}, 2000);
		}
	}

	const core = createManagedChannel(supabase, {
		channelName,
		table: 'sessions',
		event: 'UPDATE',
		filter: `id=eq.${config.sessionId}`,
		maxRetryCount,
		onPayload: config.onPayload,
		onSubscribed: () => {
			// 接続成功・再接続復帰: 最終手段(reload)もリセット
			clearErrorReloadTimer();
		},
		onMaxRetriesExhausted: () => {
			console.error(
				`[realtime/${channelName}] max retries (${maxRetryCount}) reached, falling back`
			);
			terminalFallback();
		}
	});

	return {
		cleanup: () => {
			clearErrorReloadTimer();
			core.cleanup();
		},
		getChannel: core.getChannel
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
	let pollingInterval: ReturnType<typeof setInterval> | null = null;
	let errorReloadTimer: ReturnType<typeof setTimeout> | null = null;

	function stopPolling() {
		if (pollingInterval) {
			clearInterval(pollingInterval);
			pollingInterval = null;
		}
	}

	function startPolling() {
		// Supabase は SUBSCRIBED を複数回発火しうる（再接続）。既存 interval を
		// clear してから張り直すので多重化しない。
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

	function clearErrorReloadTimer() {
		if (errorReloadTimer) {
			clearTimeout(errorReloadTimer);
			errorReloadTimer = null;
		}
	}

	// 上限つき再購読を使い果たした後の最終手段。
	function terminalFallback() {
		if (config.onError) {
			config.onError();
		} else {
			clearErrorReloadTimer();
			errorReloadTimer = setTimeout(() => {
				core.cleanup();
				window.location.reload();
			}, 2000);
		}
	}

	const core = createManagedChannel(supabase, {
		channelName,
		table: 'sessions',
		event: 'UPDATE',
		filter: `id=eq.${config.sessionId}`,
		maxRetryCount,
		onPayload: config.onRealtimePayload,
		onSubscribed: () => {
			// 接続成功・再接続復帰: 最終手段(reload)をリセットし、保険のポーリングを開始
			clearErrorReloadTimer();
			startPolling();
		},
		// エラー中もポーリングは止めない（再購読中の取りこぼしを防ぐ保険として走らせ続ける）
		onMaxRetriesExhausted: () => {
			console.error(
				`[realtime/${channelName}] max retries (${maxRetryCount}) reached, falling back`
			);
			terminalFallback();
		}
	});

	return {
		cleanup: () => {
			clearErrorReloadTimer();
			core.cleanup();
			stopPolling();
		},
		getChannel: core.getChannel
	};
}
