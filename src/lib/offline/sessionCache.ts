import { getOfflineDb } from '$lib/offline/scoreQueue';

/**
 * セッションデータの事前ダウンロード（network-resilience-strategy.md Phase 4）
 *
 * 採点フローに入った時（オンライン時）に GET /api/sessions/[id]/offline-bundle を
 * 取得して IndexedDB に保存し、オフライン中の「次の選手」継続採点で
 * 参加者（ゼッケン→選手）の検証・表示に使う。
 *
 * キャッシュはベストエフォート: 取得失敗（オフライン等）は既存キャッシュを維持して
 * null を返すだけで、呼び出し側の採点フローは阻害しない。
 */

export interface CachedParticipant {
	id: number;
	bib_number: number;
	athlete_name: string;
	team_name: string | null;
}

export interface CachedTrainingEvent {
	id: number;
	name: string;
	min_score: number;
	max_score: number;
}

export interface CachedCustomEvent {
	id: number;
	discipline: string;
	level: string;
	event_name: string;
}

export interface CachedSessionBundle {
	session_id: number;
	session_name: string;
	mode: 'certification' | 'tournament' | 'training';
	participants: CachedParticipant[];
	training_events: CachedTrainingEvent[];
	custom_events: CachedCustomEvent[];
	/** クライアントが保存した時刻（表示用） */
	cached_at: string;
}

export interface RefreshOptions {
	guestIdentifier?: string | null;
	fetchFn?: typeof fetch;
}

/**
 * サーバーから最新のセッションバンドルを取得して IndexedDB に保存する。
 * 失敗時は null（既存キャッシュは変更しない）。
 */
export async function refreshSessionCache(
	sessionId: number,
	options: RefreshOptions = {}
): Promise<CachedSessionBundle | null> {
	if (!Number.isInteger(sessionId) || sessionId <= 0) return null;
	const fetchFn = options.fetchFn ?? fetch;
	const query = options.guestIdentifier
		? `?guest=${encodeURIComponent(options.guestIdentifier)}`
		: '';

	try {
		const response = await fetchFn(`/api/sessions/${sessionId}/offline-bundle${query}`);
		if (!response.ok) return null;
		const data = (await response.json()) as Omit<CachedSessionBundle, 'cached_at'>;

		const bundle: CachedSessionBundle = {
			session_id: sessionId,
			session_name: data.session_name ?? '',
			mode: data.mode,
			participants: data.participants ?? [],
			training_events: data.training_events ?? [],
			custom_events: data.custom_events ?? [],
			cached_at: new Date().toISOString()
		};
		await getOfflineDb().cached_session_bundles.put(bundle);
		return bundle;
	} catch {
		// オフライン・JSON 不正・IndexedDB 不可など。既存キャッシュを維持
		return null;
	}
}

/** 保存済みバンドルを取得する（無ければ undefined） */
export async function getCachedSessionBundle(
	sessionId: number
): Promise<CachedSessionBundle | undefined> {
	return getOfflineDb().cached_session_bundles.get(sessionId);
}

/** キャッシュからゼッケン番号で参加者を探す（バンドル未保存・不一致は null） */
export async function findCachedParticipant(
	sessionId: number,
	bibNumber: number
): Promise<CachedParticipant | null> {
	try {
		const bundle = await getCachedSessionBundle(sessionId);
		return bundle?.participants.find((p) => p.bib_number === bibNumber) ?? null;
	} catch {
		return null;
	}
}
