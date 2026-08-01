import { readable, writable, type Readable } from 'svelte/store';
import { liveQuery } from 'dexie';
import {
	getOfflineDb,
	startAutoSync,
	syncPendingMutations,
	type SyncResult
} from '$lib/offline/scoreQueue';

/**
 * 同期状態のストア（network-resilience-strategy.md Phase 3）
 *
 * 採点画面が購読して「未同期件数 / 同期中 / 最終同期時刻 / オフライン」を表示する。
 * 件数は Dexie の liveQuery で IndexedDB の変更に追従する。
 * SSR ではすべて初期値のまま（indexedDB / window ガード済み）。
 */

function liveCount(status: 'pending' | 'rejected'): Readable<number> {
	return readable(0, (set) => {
		if (typeof indexedDB === 'undefined') {
			return;
		}
		const subscription = liveQuery(() =>
			getOfflineDb().pending_score_mutations.where('sync_status').equals(status).count()
		).subscribe({
			next: (count) => set(count),
			error: () => set(0)
		});
		return () => subscription.unsubscribe();
	});
}

/** 未同期（pending）件数 */
export const pendingCount = liveCount('pending');
/** 恒久的拒否（同期失敗）件数 */
export const rejectedCount = liveCount('rejected');
/** 同期リクエスト実行中か */
export const syncing = writable(false);
/** 最後にサーバーへ同期できた時刻（受理件数があった同期のみ更新） */
export const lastSyncedAt = writable<Date | null>(null);
/** ブラウザがオフライン判定か */
export const isOffline = writable(false);

let stopAutoSync: (() => void) | null = null;
let stopListeners: (() => void) | null = null;
let refCount = 0;

function handleSyncResult(result: SyncResult): void {
	syncing.set(false);
	if (result.synced > 0) {
		lastSyncedAt.set(new Date());
	}
	if (result.offline) {
		isOffline.set(true);
	} else if (navigator.onLine !== false) {
		isOffline.set(false);
	}
}

/**
 * 自動同期と接続状態の監視を開始する（採点画面の onMount から呼ぶ）。
 * 複数画面から呼ばれても実体は1つ（参照カウント）。戻り値で解除する。
 */
export function startOfflineSync(fetchFn: typeof fetch = fetch): () => void {
	if (typeof window === 'undefined') {
		return () => {};
	}

	refCount++;
	if (refCount === 1) {
		isOffline.set(navigator.onLine === false);

		const onOnline = () => isOffline.set(false);
		const onOffline = () => isOffline.set(true);
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		stopListeners = () => {
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
		};

		stopAutoSync = startAutoSync({
			fetchFn,
			onSyncStart: () => syncing.set(true),
			onSyncResult: handleSyncResult,
			onSyncError: () => syncing.set(false)
		});
	}

	let released = false;
	return () => {
		if (released) return;
		released = true;
		refCount--;
		if (refCount === 0) {
			stopAutoSync?.();
			stopAutoSync = null;
			stopListeners?.();
			stopListeners = null;
			syncing.set(false);
		}
	};
}

/** 手動で即時同期する（採点直後のオフライン復帰時などに使う） */
export async function syncNow(fetchFn: typeof fetch = fetch): Promise<SyncResult> {
	syncing.set(true);
	try {
		const result = await syncPendingMutations(fetchFn);
		handleSyncResult(result);
		return result;
	} catch (err) {
		syncing.set(false);
		throw err;
	}
}
