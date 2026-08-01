/**
 * オフライン採点キューのユニットテスト
 *
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	enqueueScoreMutation,
	getPendingCount,
	getRejectedCount,
	markMutationSynced,
	removeMutation,
	syncPendingMutations,
	resetOfflineDbForTests
} from '$lib/offline/scoreQueue';
import { isPermanentActionFailureStatus } from '$lib/syncContract';

const baseInput = {
	session_id: 1,
	mode_type: 'training' as const,
	event_id: 10,
	bib_number: 5,
	score: 80
};

function okResponse(body: unknown): Response {
	return { ok: true, json: async () => body } as unknown as Response;
}

beforeEach(async () => {
	resetOfflineDbForTests();
	await Dexie.delete('tento-offline');
});

describe('enqueueScoreMutation', () => {
	it('端末保存され pending としてカウントされる', async () => {
		const saved = await enqueueScoreMutation(baseInput);

		expect(saved.client_mutation_id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(saved.sync_status).toBe('pending');
		expect(await getPendingCount()).toBe(1);
	});
});

describe('enqueueScoreMutation の supersede（同一対象の再採点）', () => {
	it('同一対象を再 enqueue すると古い pending が置換され、最新1件だけ残る', async () => {
		const first = await enqueueScoreMutation({ ...baseInput, score: 80 });
		const second = await enqueueScoreMutation({ ...baseInput, score: 85 });

		expect(await getPendingCount()).toBe(1);

		// 同期で送られるのは最新の1件（古い点数への巻き戻りが構造的に起きない）
		const fetchFn = vi.fn(
			async (_url: string, init?: RequestInit) => (
				void init,
				okResponse({ accepted: [second.client_mutation_id], rejected: [] })
			)
		);
		await syncPendingMutations(fetchFn as unknown as typeof fetch);
		const body = JSON.parse(String(fetchFn.mock.calls[0]![1]!.body));
		expect(body.mutations).toHaveLength(1);
		expect(body.mutations[0].client_mutation_id).toBe(second.client_mutation_id);
		expect(body.mutations[0].client_mutation_id).not.toBe(first.client_mutation_id);
		expect(body.mutations[0].score).toBe(85);
	});

	it('対象が異なれば（別 bib）両方 pending に残る', async () => {
		await enqueueScoreMutation({ ...baseInput, bib_number: 5 });
		await enqueueScoreMutation({ ...baseInput, bib_number: 6 });

		expect(await getPendingCount()).toBe(2);
	});

	it('同一対象の rejected も再採点で置換される（「同期失敗」表示が残らない）', async () => {
		const saved = await enqueueScoreMutation(baseInput);
		const fetchFn = vi.fn(async () =>
			okResponse({
				accepted: [],
				rejected: [{ client_mutation_id: saved.client_mutation_id, reason: 'mode_mismatch' }]
			})
		);
		await syncPendingMutations(fetchFn as unknown as typeof fetch);
		expect(await getRejectedCount()).toBe(1);

		await enqueueScoreMutation({ ...baseInput, score: 90 });

		expect(await getRejectedCount()).toBe(0);
		expect(await getPendingCount()).toBe(1);
	});
});

describe('isPermanentActionFailureStatus（action fail の恒久/一時分類）', () => {
	it('検証拒否系 4xx のみ恒久（キューから除去してよい）', () => {
		for (const status of [400, 403, 404, 409]) {
			expect(isPermanentActionFailureStatus(status)).toBe(true);
		}
	});

	it('401/408/429/5xx は一時的失敗（キュー保持して再送）', () => {
		for (const status of [401, 408, 429, 500, 502, 503]) {
			expect(isPermanentActionFailureStatus(status)).toBe(false);
		}
	});
});

describe('markMutationSynced / removeMutation（オンライン経路との整合）', () => {
	it('markMutationSynced で pending から消え、同期 API へは送られない', async () => {
		const saved = await enqueueScoreMutation(baseInput);

		await markMutationSynced(saved.client_mutation_id);

		expect(await getPendingCount()).toBe(0);
		const fetchFn = vi.fn();
		await syncPendingMutations(fetchFn as unknown as typeof fetch);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('removeMutation でキューから完全に消える（rejected にもならない）', async () => {
		const saved = await enqueueScoreMutation(baseInput);

		await removeMutation(saved.client_mutation_id);

		expect(await getPendingCount()).toBe(0);
		expect(await getRejectedCount()).toBe(0);
	});

	it('存在しない mutation id を渡しても throw せず他の pending に影響しない', async () => {
		await enqueueScoreMutation(baseInput);

		await markMutationSynced('00000000-0000-4000-8000-000000000000');
		await removeMutation('00000000-0000-4000-8000-000000000000');

		expect(await getPendingCount()).toBe(1);
	});
});

describe('syncPendingMutations', () => {
	it('accepted された mutation は synced になり pending から消える', async () => {
		const saved = await enqueueScoreMutation(baseInput);
		const fetchFn = vi.fn(
			async (_url: string, init?: RequestInit) => (
				void init,
				okResponse({ accepted: [saved.client_mutation_id], rejected: [] })
			)
		);

		const result = await syncPendingMutations(fetchFn as unknown as typeof fetch);

		expect(result).toMatchObject({ synced: 1, rejected: 0, remaining: 0, offline: false });
		expect(await getPendingCount()).toBe(0);
		// 送信 payload に冪等キーが含まれる
		const init = fetchFn.mock.calls[0]![1]!;
		const body = JSON.parse(String(init.body));
		expect(body.mutations[0].client_mutation_id).toBe(saved.client_mutation_id);
	});

	it('恒久的拒否（mode_mismatch 等）は rejected になり再送されない', async () => {
		const saved = await enqueueScoreMutation(baseInput);
		const fetchFn = vi.fn(async () =>
			okResponse({
				accepted: [],
				rejected: [{ client_mutation_id: saved.client_mutation_id, reason: 'mode_mismatch' }]
			})
		);

		const result = await syncPendingMutations(fetchFn as unknown as typeof fetch);

		expect(result).toMatchObject({ synced: 0, rejected: 1, remaining: 0 });
		expect(await getRejectedCount()).toBe(1);

		// 2回目の同期では送信対象が無い（fetch されない）
		const fetchFn2 = vi.fn();
		await syncPendingMutations(fetchFn2 as unknown as typeof fetch);
		expect(fetchFn2).not.toHaveBeenCalled();
	});

	it('再送可能な拒否（auth_required）は pending のまま retry_count が増える', async () => {
		const saved = await enqueueScoreMutation(baseInput);
		const fetchFn = vi.fn(async () =>
			okResponse({
				accepted: [],
				rejected: [{ client_mutation_id: saved.client_mutation_id, reason: 'auth_required' }]
			})
		);

		const result = await syncPendingMutations(fetchFn as unknown as typeof fetch);

		expect(result).toMatchObject({ synced: 0, rejected: 0, remaining: 1 });
		expect(await getPendingCount()).toBe(1);
		// 進捗ゼロのバッチで停止する（同一同期内で無限ループしない）
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('ネットワーク到達失敗時は全件保持し offline: true を返す', async () => {
		await enqueueScoreMutation(baseInput);
		const fetchFn = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});

		const result = await syncPendingMutations(fetchFn as unknown as typeof fetch);

		expect(result).toMatchObject({ synced: 0, rejected: 0, remaining: 1, offline: true });
		expect(await getPendingCount()).toBe(1);
	});

	it('サーバーエラー（非2xx）でも全件保持する', async () => {
		await enqueueScoreMutation(baseInput);
		const fetchFn = vi.fn(
			async () => ({ ok: false, json: async () => ({}) }) as unknown as Response
		);

		const result = await syncPendingMutations(fetchFn as unknown as typeof fetch);

		expect(result).toMatchObject({ synced: 0, rejected: 0, remaining: 1, offline: false });
	});

	it('2xx でも JSON でない応答（キャプティブポータル等）は全件保持して offline: true', async () => {
		await enqueueScoreMutation(baseInput);
		const fetchFn = vi.fn(
			async () =>
				({
					ok: true,
					json: async () => {
						throw new SyntaxError('Unexpected token < in JSON');
					}
				}) as unknown as Response
		);

		const result = await syncPendingMutations(fetchFn as unknown as typeof fetch);

		expect(result).toMatchObject({ synced: 0, rejected: 0, remaining: 1, offline: true });
		expect(await getPendingCount()).toBe(1);
	});

	it('pending が無ければ fetch しない', async () => {
		const fetchFn = vi.fn();
		const result = await syncPendingMutations(fetchFn as unknown as typeof fetch);

		expect(result).toMatchObject({ synced: 0, remaining: 0 });
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
