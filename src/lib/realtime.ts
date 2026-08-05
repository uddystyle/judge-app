import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { createSerializedAsync } from '$lib/serializedAsync';

const DEFAULT_MAX_RETRY = 5;
/** 1回のポーリングに許す上限。超えたら錠を解放して次の周期へ進む */
const DEFAULT_POLLING_TIMEOUT_MS = 15000;
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
	onPayload: (payload: any) => void | Promise<void>;
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
	pollingFn: (signal?: AbortSignal) => Promise<void>;
	/** 1回のポーリングの上限（既定 15 秒）。ハング時に錠を解放するための保険 */
	pollingTimeoutMs?: number;
	onConnectionError?: (hasError: boolean) => void;
	/** SUBSCRIBED 時の追加処理（リトライ状態リセット・ポーリング停止の後に呼ばれる） */
	onSubscribed?: () => void | Promise<void>;
	/** true なら購読確立を待たずに直ちにフォールバックポーリングを開始する（取りこぼし対策） */
	startPollingImmediately?: boolean;
	/** true ならエラーステータス検知時点でポーリングを開始する（リトライ上限を待たない） */
	startPollingOnErrorStatus?: boolean;
	/**
	 * SUBSCRIBED 中も無音故障を検知する低頻度ポーリング間隔。default 30000ms。
	 * false の場合のみ、接続確立中のヘルスポーリングを無効化する。
	 */
	subscribedPollingIntervalMs?: number | false;
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
	onPayload: (payload: any) => void | Promise<void>;
	/** SUBSCRIBED 時の追加処理（コアが retryCount リセット・retryTimer クリアを済ませた後） */
	onSubscribed?: () => void | Promise<void>;
	/** エラーステータス時の追加処理（バックオフ再購読の前） */
	onErrorStatus?: () => void | Promise<void>;
	/** 再購読上限到達時の最終手段（ログ出力も呼び出し側の責務） */
	onMaxRetriesExhausted: () => void | Promise<void>;
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
	let disposed = false;
	let generation = 0;

	function runCallback(callback: (() => void | Promise<void>) | undefined, label: string) {
		if (!callback || disposed) return;
		try {
			void Promise.resolve(callback()).catch((error) => {
				console.error(`[realtime/${opts.channelName}] ${label} failed:`, error);
			});
		} catch (error) {
			console.error(`[realtime/${opts.channelName}] ${label} failed:`, error);
		}
	}

	function clearRetryTimer() {
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
	}

	function removeChannel() {
		if (channel) {
			const channelToRemove = channel;
			channel = null;
			// removeChannel() itself emits CLOSED. Invalidate this generation first so
			// an intentional unsubscribe cannot schedule a replacement subscription.
			generation++;
			try {
				void Promise.resolve(supabase.removeChannel(channelToRemove)).catch((error) => {
					console.error(`[realtime/${opts.channelName}] removeChannel failed:`, error);
				});
			} catch (error) {
				console.error(`[realtime/${opts.channelName}] removeChannel failed:`, error);
			}
		}
	}

	function retryConnection() {
		if (disposed) return;
		// 既存タイマーをクリアして重複購読を防ぐ
		clearRetryTimer();

		if (retryCount >= opts.maxRetryCount) {
			runCallback(opts.onMaxRetriesExhausted, 'max retry callback');
			return;
		}

		const backoffDelay = Math.pow(2, retryCount) * 1000;
		retryCount++;
		console.log(
			`[realtime/${opts.channelName}] retry ${retryCount}/${opts.maxRetryCount} in ${backoffDelay}ms`
		);

		const scheduledGeneration = generation;
		retryTimer = setTimeout(() => {
			if (disposed || scheduledGeneration !== generation) return;
			retryTimer = null;
			removeChannel();
			setupChannel();
		}, backoffDelay);
	}

	function setupChannel() {
		if (disposed) return;
		const channelGeneration = ++generation;
		let failureHandled = false;
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
					if (disposed || channelGeneration !== generation) return;
					runCallback(() => opts.onPayload(payload), 'payload callback');
				}
			)
			.subscribe((status: string) => {
				if (disposed || channelGeneration !== generation) return;
				console.log(`[realtime/${opts.channelName}] status:`, status);
				if (status === 'SUBSCRIBED') {
					failureHandled = false;
					console.log(`[realtime/${opts.channelName}] connected`);
					// 接続成功でリトライ状態をリセット（再購読の上限を使い果たさない）
					retryCount = 0;
					clearRetryTimer();
					runCallback(opts.onSubscribed, 'subscribed callback');
				} else if (isErrorStatus(status)) {
					// Supabase can report CHANNEL_ERROR followed by CLOSED for the same
					// failure. Count and schedule it only once per channel generation.
					if (failureHandled) return;
					failureHandled = true;
					console.error(`[realtime/${opts.channelName}] error:`, status);
					runCallback(opts.onErrorStatus, 'error status callback');
					// 即諦めず、上限つきバックオフ再購読
					retryConnection();
				}
			});
	}

	setupChannel();

	return {
		cleanup: () => {
			if (disposed) return;
			disposed = true;
			clearRetryTimer();
			removeChannel();
		},
		getChannel: () => channel,
		cancelRetry: () => {
			clearRetryTimer();
			retryCount = 0;
		},
		reconnect: () => {
			if (disposed) return;
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
	const subscribedPollingIntervalMs = config.subscribedPollingIntervalMs ?? 30000;

	let fallbackPolling: ReturnType<typeof setInterval> | null = null;
	let activePollingIntervalMs: number | null = null;
	let connectionError = false;
	let disposed = false;
	const pollingRunner = createSerializedAsync(config.pollingFn, {
		pendingDelayMs: 0,
		// ⚠️ 期限は必須。PostgREST が一度ハングすると直列化の錠が解放されず、
		// その画面のポーリングが以後まったく走らなくなる（復旧手段が再読み込みだけになる）。
		// ポーリング間隔より十分長く、かつ現場が待てる範囲として 15 秒。
		timeoutMs: config.pollingTimeoutMs ?? DEFAULT_POLLING_TIMEOUT_MS,
		onError: (error) => {
			console.error(`[realtime/${config.channelName}] fallback polling failed:`, error);
		}
	});

	function startPolling(intervalMs: number, reason: 'fallback' | 'health') {
		if (disposed || (fallbackPolling && activePollingIntervalMs === intervalMs)) return;
		stopPolling();

		console.log(`[realtime/${config.channelName}] ${reason} polling started (${intervalMs}ms)`);
		activePollingIntervalMs = intervalMs;
		fallbackPolling = setInterval(() => pollingRunner.run(), intervalMs);
	}

	function stopPolling() {
		if (fallbackPolling) {
			clearInterval(fallbackPolling);
			fallbackPolling = null;
		}
		activePollingIntervalMs = null;
		pollingRunner.cleanup();
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
			// SUBSCRIBED は配信保証ではないため、publication/RLS drift を拾う
			// 低頻度のヘルスポーリングは継続する。
			if (subscribedPollingIntervalMs === false) {
				stopPolling();
			} else {
				startPolling(subscribedPollingIntervalMs, 'health');
			}
			return config.onSubscribed?.();
		},
		onErrorStatus: () => {
			connectionError = true;
			config.onConnectionError?.(true);
			if (config.startPollingOnErrorStatus) {
				startPolling(pollingIntervalMs, 'fallback');
			}
		},
		onMaxRetriesExhausted: () => {
			console.error(
				`[realtime/${config.channelName}] max retries (${maxRetryCount}) reached, switching to fallback polling`
			);
			connectionError = true;
			config.onConnectionError?.(true);
			startPolling(pollingIntervalMs, 'fallback');
		}
	});

	// 取りこぼし対策: 購読確立前は短周期、確立後は低頻度のヘルスポーリングへ移行する。
	if (config.startPollingImmediately) {
		startPolling(pollingIntervalMs, 'fallback');
	}

	return {
		cleanup: () => {
			if (disposed) return;
			disposed = true;
			core.cleanup();
			stopPolling();
		},
		getChannel: core.getChannel,
		hasConnectionError: () => connectionError,
		manualRefresh: async (refreshFn?: () => Promise<void>) => {
			if (disposed) return;
			// 保留中のバックオフ再購読をキャンセルして重複 setupChannel を防ぐ
			core.cancelRetry();

			connectionError = false;
			config.onConnectionError?.(false);

			stopPolling();

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
		onPayload: (payload: any) => void | Promise<void>;
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
		onRealtimePayload: (payload: any) => void | Promise<void>;
		onPollingData: (data: {
			is_active: boolean;
			active_prompt_id: string | null;
		}) => void | Promise<void>;
		onError?: () => void;
	}
): RealtimeChannelHandle {
	const prefix = config.channelPrefix || 'session-end';
	const channelName = `${prefix}-${config.sessionId}`;
	const pollingMs = config.pollingIntervalMs ?? 3000;
	const maxRetryCount = config.maxRetryCount ?? DEFAULT_MAX_RETRY;
	let pollingInterval: ReturnType<typeof setInterval> | null = null;
	let disposed = false;
	const pollingRunner = createSerializedAsync(
		async (signal) => {
			if (disposed) return;
			const { data, error } = await supabase
				.from('sessions')
				.select('is_active, active_prompt_id')
				.eq('id', config.sessionId)
				.abortSignal(signal!)
				.single();

			if (!disposed && !error && data) {
				await config.onPollingData(data as any);
			}
		},
		{
			pendingDelayMs: 0,
			timeoutMs: DEFAULT_POLLING_TIMEOUT_MS,
			onError: (error) => {
				console.error(`[realtime/${channelName}] polling failed:`, error);
			}
		}
	);

	function stopPolling() {
		if (pollingInterval) {
			clearInterval(pollingInterval);
			pollingInterval = null;
		}
		pollingRunner.cleanup();
	}

	function startPolling() {
		if (disposed) return;
		// Supabase は SUBSCRIBED を複数回発火しうる（再接続）。既存 interval を
		// clear してから張り直すので多重化しない。
		stopPolling();
		pollingInterval = setInterval(() => pollingRunner.run(), pollingMs);
	}

	const core = createManagedChannel(supabase, {
		channelName,
		table: 'sessions',
		event: 'UPDATE',
		filter: `id=eq.${config.sessionId}`,
		maxRetryCount,
		onPayload: config.onRealtimePayload,
		onSubscribed: () => {
			// 接続成功・再接続復帰後も、無音故障対策としてポーリングを維持する。
			startPolling();
		},
		// エラー中もポーリングは止めない（再購読中の取りこぼしを防ぐ保険として走らせ続ける）
		onMaxRetriesExhausted: () => {
			console.error(
				`[realtime/${channelName}] max retries (${maxRetryCount}) reached, falling back`
			);
			// ポーリングが状態監視を継続するため、ページreloadは行わない。
			config.onError?.();
		}
	});

	// Realtime が一度も SUBSCRIBED にならない場合も状態監視を継続する。
	startPolling();

	return {
		cleanup: () => {
			if (disposed) return;
			disposed = true;
			core.cleanup();
			stopPolling();
		},
		getChannel: core.getChannel
	};
}
