/**
 * セッションデータ事前ダウンロード（オフラインバンドル）のユニットテスト
 *
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	refreshSessionCache,
	getCachedSessionBundle,
	findCachedParticipant
} from '$lib/offline/sessionCache';
import {
	enqueueScoreMutation,
	getOfflineDb,
	getPendingCount,
	resetOfflineDbForTests,
	syncPendingMutations
} from '$lib/offline/scoreQueue';

const serverBundle = {
	session_id: 1,
	session_name: 'テスト研修',
	mode: 'training' as const,
	participants: [
		{ id: 10, bib_number: 5, athlete_name: '選手5', team_name: null },
		{ id: 11, bib_number: 6, athlete_name: '田中', team_name: 'チームA' }
	],
	training_events: [{ id: 100, name: '小回り', min_score: 0, max_score: 100 }],
	custom_events: []
};

function okResponse(body: unknown): Response {
	return { ok: true, json: async () => body } as unknown as Response;
}

beforeEach(async () => {
	resetOfflineDbForTests();
	await Dexie.delete('tento-offline');
});

describe('refreshSessionCache', () => {
	it('取得したバンドルを保存し cached_at を付与して返す', async () => {
		const fetchFn = vi.fn(async (url: string) => (void url, okResponse(serverBundle)));

		const bundle = await refreshSessionCache(1, { fetchFn: fetchFn as unknown as typeof fetch });

		expect(fetchFn.mock.calls[0]![0]).toBe('/api/sessions/1/offline-bundle');
		expect(bundle?.participants).toHaveLength(2);
		expect(bundle?.cached_at).toBeTruthy();
		const stored = await getCachedSessionBundle(1);
		expect(stored?.session_name).toBe('テスト研修');
	});

	it('guestIdentifier は ?guest= として付与される', async () => {
		const fetchFn = vi.fn(async (url: string) => (void url, okResponse(serverBundle)));

		await refreshSessionCache(1, {
			guestIdentifier: 'guest-123',
			fetchFn: fetchFn as unknown as typeof fetch
		});

		expect(fetchFn.mock.calls[0]![0]).toBe('/api/sessions/1/offline-bundle?guest=guest-123');
	});

	it('非2xx 応答は null を返し、既存キャッシュを維持する', async () => {
		await refreshSessionCache(1, {
			fetchFn: (async () => okResponse(serverBundle)) as unknown as typeof fetch
		});
		const failFetch = async () => ({ ok: false }) as unknown as Response;

		const result = await refreshSessionCache(1, {
			fetchFn: failFetch as unknown as typeof fetch
		});

		expect(result).toBeNull();
		expect((await getCachedSessionBundle(1))?.session_name).toBe('テスト研修');
	});

	it('fetch が throw（オフライン）でも null を返すだけで既存キャッシュを維持する', async () => {
		await refreshSessionCache(1, {
			fetchFn: (async () => okResponse(serverBundle)) as unknown as typeof fetch
		});
		const offlineFetch = async () => {
			throw new TypeError('Failed to fetch');
		};

		const result = await refreshSessionCache(1, {
			fetchFn: offlineFetch as unknown as typeof fetch
		});

		expect(result).toBeNull();
		expect(await getCachedSessionBundle(1)).toBeTruthy();
	});

	it('不正な sessionId は fetch せず null', async () => {
		const fetchFn = vi.fn();
		expect(
			await refreshSessionCache(0, { fetchFn: fetchFn as unknown as typeof fetch })
		).toBeNull();
		expect(
			await refreshSessionCache(NaN, { fetchFn: fetchFn as unknown as typeof fetch })
		).toBeNull();
		expect(fetchFn).not.toHaveBeenCalled();
	});
});

describe('findCachedParticipant', () => {
	it('ゼッケン一致の参加者を返し、未登録・未キャッシュは null', async () => {
		await refreshSessionCache(1, {
			fetchFn: (async () => okResponse(serverBundle)) as unknown as typeof fetch
		});

		expect((await findCachedParticipant(1, 6))?.athlete_name).toBe('田中');
		expect(await findCachedParticipant(1, 99)).toBeNull();
		expect(await findCachedParticipant(2, 5)).toBeNull();
	});
});

describe('バンドルの保持期限（PII を無期限に残さない）', () => {
	it('30日超のバンドルは同期時に purge され、新しいバンドルは残る', async () => {
		const db = getOfflineDb();
		const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
		await db.cached_session_bundles.put({ ...serverBundle, session_id: 1, cached_at: oldDate });
		await db.cached_session_bundles.put({
			...serverBundle,
			session_id: 2,
			cached_at: new Date().toISOString()
		});

		await syncPendingMutations((async () => {
			throw new Error('no pending expected');
		}) as unknown as typeof fetch);

		expect(await getCachedSessionBundle(1)).toBeUndefined();
		expect(await getCachedSessionBundle(2)).toBeTruthy();
	});
});

describe('Dexie v2 スキーマ共存', () => {
	it('採点キューとバンドルが同一 DB で共存する', async () => {
		await enqueueScoreMutation({
			session_id: 1,
			mode_type: 'training',
			event_id: 100,
			bib_number: 5,
			score: 80
		});
		await refreshSessionCache(1, {
			fetchFn: (async () => okResponse(serverBundle)) as unknown as typeof fetch
		});

		expect(await getPendingCount()).toBe(1);
		expect((await getCachedSessionBundle(1))?.mode).toBe('training');
	});
});
