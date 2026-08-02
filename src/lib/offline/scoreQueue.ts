import Dexie, { type Table } from 'dexie';
import { isRetryableReason } from '$lib/syncContract';
import type { CachedSessionBundle } from '$lib/offline/sessionCache';

/**
 * オフライン採点キュー（network-resilience-strategy.md Phase 1）
 *
 * 採点はまず IndexedDB に保存し（=「端末保存済み」）、通信可能時に
 * /api/sync/scores へ client_mutation_id 付きで送信する。
 *
 * sync_status の遷移:
 *   pending  → 同期待ち（未同期）
 *   synced   → サーバー受理済み
 *   rejected → サーバーが恒久的に拒否（再送しない。last_error に理由）
 * ネットワーク失敗・一時的失敗（$lib/syncContract.ts の RETRYABLE_REASONS）は
 * pending のまま retry_count++。
 */

export type SyncStatus = 'pending' | 'synced' | 'rejected';
export type OwnerType = 'auth' | 'guest';

export interface SyncIdentity {
	owner_type: OwnerType;
	judge_id: string | null;
	guest_identifier: string | null;
}

export interface PendingScoreMutation {
	id?: number;
	client_mutation_id: string;
	owner_type: OwnerType;
	session_id: number;
	mode_type: 'certification' | 'tournament' | 'training';
	event_id: number | null;
	discipline: string | null;
	level: string | null;
	event_name: string | null;
	bib_number: number;
	score: number;
	judge_id: string | null;
	guest_identifier: string | null;
	created_at_local: string;
	sync_status: SyncStatus;
	last_error: string | null;
	retry_count: number;
	/**
	 * サーバーに到達したうえで per-mutation の retryable 拒否（auth_required 等）を
	 * 受けた回数。ネットワーク/5xx のバッチ失敗（bumpRetry）ではカウントしない。
	 * これが上限に達し十分な時間が経過したら、無限リトライを打ち切り rejected にする。
	 */
	server_retry_count?: number;
	/**
	 * 最初にサーバー到達済みの retryable 拒否を受けた時刻。give-up 判定はこの「失敗開始」
	 * からの経過で測る（作成時刻ではない）。長期オフライン後の復帰時に一過性障害が起きても、
	 * 失敗が継続していなければ打ち切らない（正当な採点を誤って捨てない）ため。
	 */
	first_server_reject_at?: string | null;
	/** サーバー受理時刻（synced 行の保持期限判定に使う） */
	synced_at?: string | null;
}

const SYNC_ENDPOINT = '/api/sync/scores';
const MAX_BATCH_SIZE = 50;
/** 1回の同期で処理するバッチ数の上限（大量バックログの一括ドレイン用） */
const MAX_BATCHES_PER_SYNC = 10;
/** synced 行を保持する日数（監査・表示用。経過後に purge） */
const SYNCED_RETENTION_DAYS = 7;
/** セッションバンドル（名簿キャッシュ）を保持する日数。経過後に purge（PII を無期限に残さない） */
const BUNDLE_RETENTION_DAYS = 30;
/**
 * サーバー到達済みの retryable 拒否がこの回数に達し、かつ「失敗開始」から MIN_STUCK_AGE_MS
 * 継続したら、無限リトライを打ち切って rejected にする（別セッション残留・トークン喪失で
 * 二度と解けない mutation を「同期失敗」として表面化）。両条件 AND かつ経過は失敗開始基準
 * なので、一過性の DB エラー・長期オフライン・復帰時の瞬断では発火しない。
 */
const MAX_SERVER_REJECTS = 10;
const MIN_STUCK_AGE_MS = 6 * 60 * 60 * 1000;

class OfflineScoreDb extends Dexie {
	pending_score_mutations!: Table<PendingScoreMutation, number>;
	cached_session_bundles!: Table<CachedSessionBundle, number>;

	constructor() {
		super('tento-offline');
		this.version(1).stores({
			// インデックス: 主キー(auto) / 一意な mutation id / 状態 / セッション
			pending_score_mutations: '++id, &client_mutation_id, sync_status, session_id'
		});
		// v2: セッションデータの事前ダウンロード（戦略文書 Phase 4）。session_id が主キー
		this.version(2).stores({
			pending_score_mutations: '++id, &client_mutation_id, sync_status, session_id',
			cached_session_bundles: '&session_id'
		});
		// v3: owner_type/judge_id 導入。旧 v1/v2 行は owner_type を持たないため owner を
		// 判別できず identity フィルタで永久に送信対象外になる。ここで一度だけ整合させる:
		// guest 行は owner_type='guest'、判別不能な旧 auth pending 行（owner_type/guest_identifier
		// 双方無し）は「同期失敗(legacy_no_owner)」として表面化させ purge 可能にする（見えない滞留を防ぐ）。
		this.version(3)
			.stores({
				pending_score_mutations: '++id, &client_mutation_id, sync_status, session_id',
				cached_session_bundles: '&session_id'
			})
			.upgrade(async (tx) => {
				await tx
					.table('pending_score_mutations')
					.toCollection()
					.modify((m: PendingScoreMutation) => {
						if (m.owner_type) return;
						if (m.guest_identifier) {
							m.owner_type = 'guest';
						} else if (m.sync_status === 'pending') {
							m.sync_status = 'rejected';
							m.last_error = 'legacy_no_owner';
						} else {
							m.owner_type = 'auth';
						}
					});
			});
	}
}

let dbInstance: OfflineScoreDb | null = null;
let currentSyncIdentity: SyncIdentity | null = null;

export function getOfflineDb(): OfflineScoreDb {
	if (!dbInstance) {
		dbInstance = new OfflineScoreDb();
	}
	return dbInstance;
}

/** テスト用: シングルトンを破棄する */
export function resetOfflineDbForTests(): void {
	dbInstance?.close();
	dbInstance = null;
	currentSyncIdentity = null;
}

const identityListeners = new Set<() => void>();

/**
 * 現在このブラウザで同期してよい owner identity を設定する。
 * 未設定時は owner 付き mutation を送信しない（別人Cookieでの誤同期を避ける）。
 * 変更時にリスナーへ通知する（UI の identity スコープ件数を再計算させるため）。
 */
export function setCurrentSyncIdentity(identity: SyncIdentity | null): void {
	currentSyncIdentity = identity;
	for (const cb of identityListeners) {
		try {
			cb();
		} catch {
			// リスナー側のエラーは同期状態に影響させない
		}
	}
}

/** identity 変更を購読する（syncStatus の件数ストアが再計算に使う）。戻り値で解除 */
export function subscribeSyncIdentity(cb: () => void): () => void {
	identityListeners.add(cb);
	return () => identityListeners.delete(cb);
}

/** mutation が現在の同期 identity に属するか（UI の件数スコープ用に公開） */
export function matchesCurrentSyncIdentity(mutation: PendingScoreMutation): boolean {
	return mutationMatchesCurrentIdentity(mutation);
}

/**
 * client_mutation_id の生成。
 * crypto.randomUUID は secure context 限定のため、開発時の LAN IP + http などでは
 * フォールバック（v4 形式）を使う（端末保存自体が失敗しないことを優先）。
 */
function generateMutationId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	// Math.random で十分（暗号用途ではなく衝突回避用。非 secure context の開発時フォールバック）
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

export interface EnqueueInput {
	session_id: number;
	mode_type: PendingScoreMutation['mode_type'];
	event_id?: number | null;
	discipline?: string | null;
	level?: string | null;
	event_name?: string | null;
	bib_number: number;
	score: number;
	judge_id?: string | null;
	guest_identifier?: string | null;
}

/** 同一の採点対象（このキーが全て一致する mutation は同じ1枠の採点）かどうか */
function isSameTarget(a: PendingScoreMutation, b: PendingScoreMutation): boolean {
	return (
		a.session_id === b.session_id &&
		a.mode_type === b.mode_type &&
		a.event_id === b.event_id &&
		a.discipline === b.discipline &&
		a.level === b.level &&
		a.event_name === b.event_name &&
		a.bib_number === b.bib_number &&
		a.judge_id === b.judge_id &&
		a.guest_identifier === b.guest_identifier
	);
}

function resolveOwner(input: EnqueueInput): SyncIdentity {
	const guestIdentifier = input.guest_identifier ?? null;
	if (guestIdentifier) {
		return { owner_type: 'guest', judge_id: null, guest_identifier: guestIdentifier };
	}
	return { owner_type: 'auth', judge_id: input.judge_id ?? null, guest_identifier: null };
}

function mutationMatchesCurrentIdentity(mutation: PendingScoreMutation): boolean {
	if (!currentSyncIdentity) return false;

	// v3 以前に owner_type が無い行の保険。guest_identifier があれば guest とみなすが、
	// judge_id も guest_identifier も無い旧 auth 行は安全に送れないため対象外。
	const ownerType = mutation.owner_type ?? (mutation.guest_identifier ? 'guest' : null);
	if (!ownerType) return false;

	if (ownerType !== currentSyncIdentity.owner_type) return false;
	if (ownerType === 'guest') {
		return (
			!!mutation.guest_identifier &&
			mutation.guest_identifier === currentSyncIdentity.guest_identifier
		);
	}
	return !!mutation.judge_id && mutation.judge_id === currentSyncIdentity.judge_id;
}

/**
 * 採点をローカルキューへ保存する（=「端末保存済み」）。
 * 戻り値の client_mutation_id が同期の冪等キーになる。
 *
 * 同一対象の古い pending / rejected は削除してから追加する（supersede）。
 * これで「古い pending がオンライン保存済みの新しい点数へ自動同期で巻き戻す」
 * 経路が構造的に消える（対象ごとに未同期は常に最新1件）。
 */
export async function enqueueScoreMutation(input: EnqueueInput): Promise<PendingScoreMutation> {
	const owner = resolveOwner(input);
	const mutation: PendingScoreMutation = {
		client_mutation_id: generateMutationId(),
		owner_type: owner.owner_type,
		session_id: input.session_id,
		mode_type: input.mode_type,
		event_id: input.event_id ?? null,
		discipline: input.discipline ?? null,
		level: input.level ?? null,
		event_name: input.event_name ?? null,
		bib_number: input.bib_number,
		score: input.score,
		judge_id: owner.judge_id,
		guest_identifier: owner.guest_identifier,
		created_at_local: new Date().toISOString(),
		sync_status: 'pending',
		last_error: null,
		retry_count: 0,
		server_retry_count: 0,
		first_server_reject_at: null,
		synced_at: null
	};

	const db = getOfflineDb();
	const id = await db.transaction('rw', db.pending_score_mutations, async () => {
		await db.pending_score_mutations
			.where('session_id')
			.equals(mutation.session_id)
			.filter((m) => m.sync_status !== 'synced' && isSameTarget(m, mutation))
			.delete();
		return db.pending_score_mutations.add(mutation);
	});
	return { ...mutation, id };
}

/** 未同期（pending）件数 */
export async function getPendingCount(): Promise<number> {
	return getOfflineDb().pending_score_mutations.where('sync_status').equals('pending').count();
}

/** 恒久的拒否の件数（UI の「同期失敗」表示用） */
export async function getRejectedCount(): Promise<number> {
	return getOfflineDb().pending_score_mutations.where('sync_status').equals('rejected').count();
}

/**
 * オンライン経路（既存 action POST）が成功した mutation を synced にする。
 * サーバーには action 側で保存済みのため、同期 API へは送らない。
 */
export async function markMutationSynced(clientMutationId: string): Promise<void> {
	await getOfflineDb()
		.pending_score_mutations.where('client_mutation_id')
		.equals(clientMutationId)
		.modify({ sync_status: 'synced', last_error: null, synced_at: new Date().toISOString() });
}

/**
 * オンライン経路がサーバー検証で拒否（fail 4xx）した mutation をキューから取り除く。
 * サーバーが権威的に拒否した内容を再送しても同じ拒否になるだけのため。
 */
export async function removeMutation(clientMutationId: string): Promise<void> {
	await getOfflineDb()
		.pending_score_mutations.where('client_mutation_id')
		.equals(clientMutationId)
		.delete();
}

/**
 * ゲストが同一 identity を再採用した時に、その identity 宛てに
 * guest_identity_mismatch で恒久拒否された mutation を pending へ戻す（再送可能化）。
 * 別 identity で誤って再参加してキューが弾かれた後でも、正しい identity へ戻れば救済する。
 * （P3: 再認証フロー。network-resilience-strategy.md）
 * 戻り値は再 pending した件数。
 */
export async function rependMismatchedMutations(guestIdentifier: string): Promise<number> {
	if (!guestIdentifier) return 0;
	const db = getOfflineDb();
	const rejected = await db.pending_score_mutations
		.where('sync_status')
		.equals('rejected')
		.filter(
			(m) => m.guest_identifier === guestIdentifier && m.last_error === 'guest_identity_mismatch'
		)
		.toArray();
	for (const m of rejected) {
		await db.pending_score_mutations.update(m.id!, {
			sync_status: 'pending',
			last_error: null,
			server_retry_count: 0,
			first_server_reject_at: null,
			retry_count: 0
		});
	}
	return rejected.length;
}

export interface SyncResult {
	synced: number;
	rejected: number;
	remaining: number;
	/** ネットワーク到達・応答解釈自体に失敗した場合 true（キューは全件保持） */
	offline: boolean;
}

let syncInFlight: Promise<SyncResult> | null = null;

/**
 * pending の mutation をまとめて同期する。
 * 多重呼び出しは合流する（同時に2本の同期は走らない）。
 */
export function syncPendingMutations(fetchFn: typeof fetch = fetch): Promise<SyncResult> {
	if (syncInFlight) return syncInFlight;
	syncInFlight = doSync(fetchFn).finally(() => {
		syncInFlight = null;
	});
	return syncInFlight;
}

async function doSync(fetchFn: typeof fetch): Promise<SyncResult> {
	const db = getOfflineDb();
	let totalSynced = 0;
	let totalRejected = 0;
	let offline = false;

	// バックログを複数バッチでドレインする。進捗が無くなったら停止
	// （全件が一時的失敗のときに同一バッチを回し続けない）
	for (let batchIndex = 0; batchIndex < MAX_BATCHES_PER_SYNC; batchIndex++) {
		const pending = await db.pending_score_mutations
			.where('sync_status')
			.equals('pending')
			.toArray();
		const syncable = pending.filter(mutationMatchesCurrentIdentity).slice(0, MAX_BATCH_SIZE);

		if (syncable.length === 0) break;

		const batch = await sendBatch(db, fetchFn, syncable);
		totalSynced += batch.synced;
		totalRejected += batch.rejected;

		if (batch.offline) {
			offline = true;
			break;
		}
		if (batch.synced + batch.rejected === 0) break; // 進捗なし
	}

	await purgeOldSynced(db);
	await purgeOldBundles(db);

	return {
		synced: totalSynced,
		rejected: totalRejected,
		remaining: await getPendingCount(),
		offline
	};
}

async function sendBatch(
	db: OfflineScoreDb,
	fetchFn: typeof fetch,
	pending: PendingScoreMutation[]
): Promise<{ synced: number; rejected: number; offline: boolean }> {
	let result: {
		accepted?: string[];
		rejected?: { client_mutation_id: string; reason: string }[];
	};

	try {
		const response = await fetchFn(SYNC_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				mutations: pending.map((m) => ({
					client_mutation_id: m.client_mutation_id,
					session_id: m.session_id,
					mode_type: m.mode_type,
					event_id: m.event_id,
					discipline: m.discipline,
					level: m.level,
					event_name: m.event_name,
					bib_number: m.bib_number,
					score: m.score,
					owner_type: m.owner_type,
					judge_id: m.judge_id,
					guest_identifier: m.guest_identifier,
					created_at_local: m.created_at_local
				}))
			})
		});

		if (!response.ok) {
			// サーバーエラー / レート制限: 全件保持して次回再送
			await bumpRetry(db, pending);
			return { synced: 0, rejected: 0, offline: false };
		}

		// 2xx でも JSON でない応答（プロキシ・キャプティブポータル等）はここで throw
		// → ネットワーク失敗と同様に全件保持
		result = (await response.json()) as typeof result;
	} catch {
		await bumpRetry(db, pending);
		return { synced: 0, rejected: 0, offline: true };
	}

	const acceptedSet = new Set(result.accepted ?? []);
	const rejectedMap = new Map((result.rejected ?? []).map((r) => [r.client_mutation_id, r.reason]));

	let syncedCount = 0;
	let rejectedCount = 0;

	for (const m of pending) {
		if (acceptedSet.has(m.client_mutation_id)) {
			await db.pending_score_mutations.update(m.id!, {
				sync_status: 'synced',
				last_error: null,
				synced_at: new Date().toISOString()
			});
			syncedCount++;
			continue;
		}
		const reason = rejectedMap.get(m.client_mutation_id);
		if (reason && !isRetryableReason(reason)) {
			// 恒久的拒否: 再送しない
			await db.pending_score_mutations.update(m.id!, {
				sync_status: 'rejected',
				last_error: reason
			});
			rejectedCount++;
		} else {
			// 再送可能（auth_required / save_failed / 応答に含まれない）
			const serverRejects = (m.server_retry_count ?? 0) + 1;
			// 失敗開始時刻（初回のサーバー到達拒否時に確定し、以後は保持）
			const firstRejectAt = m.first_server_reject_at ?? new Date().toISOString();
			const stuckMs = Date.now() - Date.parse(firstRejectAt);
			if (serverRejects >= MAX_SERVER_REJECTS && stuckMs >= MIN_STUCK_AGE_MS) {
				// サーバーに到達しても retryable 拒否が「失敗開始から継続」し、上限も超えた
				// → これ以上ループさせず恒久失敗として表面化する（別セッション残留・トークン
				// 喪失など再送では解けないケース。「同期失敗 N件」バッジに出る）
				await db.pending_score_mutations.update(m.id!, {
					sync_status: 'rejected',
					last_error: `retry_exhausted:${reason ?? 'unknown'}`,
					server_retry_count: serverRejects,
					first_server_reject_at: firstRejectAt,
					retry_count: m.retry_count + 1
				});
				rejectedCount++;
			} else {
				// pending のまま次回再送
				await db.pending_score_mutations.update(m.id!, {
					last_error: reason ?? null,
					server_retry_count: serverRejects,
					first_server_reject_at: firstRejectAt,
					retry_count: m.retry_count + 1
				});
			}
		}
	}

	return { synced: syncedCount, rejected: rejectedCount, offline: false };
}

async function bumpRetry(db: OfflineScoreDb, pending: PendingScoreMutation[]): Promise<void> {
	for (const m of pending) {
		await db.pending_score_mutations.update(m.id!, { retry_count: m.retry_count + 1 });
	}
}

/** 保持期限切れのセッションバンドルを削除する */
async function purgeOldBundles(db: OfflineScoreDb): Promise<void> {
	const cutoff = Date.now() - BUNDLE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
	await db.cached_session_bundles.filter((b) => Date.parse(b.cached_at) < cutoff).delete();
}

/** synced 行の保持期限切れを削除する（同期時刻基準。旧データは enqueue 時刻でフォールバック） */
async function purgeOldSynced(db: OfflineScoreDb): Promise<void> {
	const cutoff = Date.now() - SYNCED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
	await db.pending_score_mutations
		.where('sync_status')
		.equals('synced')
		.filter((m) => Date.parse(m.synced_at ?? m.created_at_local) < cutoff)
		.delete();
}

const AUTO_SYNC_INTERVAL_MS = 30_000;

export interface AutoSyncOptions {
	fetchFn?: typeof fetch;
	/** 同期の開始時に呼ばれる（UI の「同期中…」表示用） */
	onSyncStart?: () => void;
	/** 各同期の完了時に結果つきで呼ばれる */
	onSyncResult?: (result: SyncResult) => void;
	/** 同期が例外で終わった時（IndexedDB 読み取り失敗等）。UI の「同期中…」解除用 */
	onSyncError?: (error: unknown) => void;
}

/**
 * 自動同期を開始する（online イベント + 定期実行。フォアグラウンド時のみ動作 —
 * iOS は Background Sync 非対応のためこれが前提。戦略文書「iOS Safari の制約」参照）。
 * pending が無いときはネットワークアクセスは発生しない（doSync が即 return）。
 * 戻り値の関数で停止する。
 */
export function startAutoSync(options: AutoSyncOptions = {}): () => void {
	const fetchFn = options.fetchFn ?? fetch;
	const safeSync = () => {
		options.onSyncStart?.();
		syncPendingMutations(fetchFn)
			.then((result) => options.onSyncResult?.(result))
			.catch((error) => {
				// IndexedDB 読み取り失敗（ITP による削除等）で doSync 自体が reject するケース。
				// 通知しないと「同期中…」表示が固まる
				options.onSyncError?.(error);
			});
	};

	const onOnline = () => {
		safeSync();
	};
	window.addEventListener('online', onOnline);
	const interval = setInterval(() => {
		if (navigator.onLine !== false) {
			safeSync();
		}
	}, AUTO_SYNC_INTERVAL_MS);

	// 開始時に一度実行
	if (navigator.onLine !== false) {
		safeSync();
	}

	return () => {
		window.removeEventListener('online', onOnline);
		clearInterval(interval);
	};
}
