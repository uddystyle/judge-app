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
	getOfflineDb,
	getPendingCount,
	getRejectedCount,
	markMutationSynced,
	removeMutation,
	rependMismatchedMutations,
	setCurrentSyncIdentity,
	syncPendingMutations,
	resetOfflineDbForTests
} from '$lib/offline/scoreQueue';
import { isPermanentActionFailureStatus } from '$lib/syncContract';

const baseInput = {
	session_id: 1,
	mode_type: 'training' as const,
	event_id: 10,
	bib_number: 5,
	score: 80,
	judge_id: 'user-1'
};

function okResponse(body: unknown): Response {
	return { ok: true, json: async () => body } as unknown as Response;
}

beforeEach(async () => {
	resetOfflineDbForTests();
	await Dexie.delete('tento-offline');
	setCurrentSyncIdentity({ owner_type: 'auth', judge_id: 'user-1', guest_identifier: null });
});

describe('enqueueScoreMutation', () => {
	it('端末保存され pending としてカウントされる', async () => {
		const saved = await enqueueScoreMutation(baseInput);

		expect(saved.client_mutation_id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(saved.sync_status).toBe('pending');
		expect(await getPendingCount()).toBe(1);
	});
});

describe('Dexie v3 マイグレーション（owner_type 導入前の行の整合）', () => {
	it('旧 auth pending 行は legacy_no_owner で rejected に、旧 guest 行は guest として維持', async () => {
		// owner_type を持たない v2 スキーマの DB を作り、旧行を投入する
		const legacyDb = new Dexie('tento-offline');
		legacyDb
			.version(1)
			.stores({ pending_score_mutations: '++id, &client_mutation_id, sync_status, session_id' });
		legacyDb.version(2).stores({
			pending_score_mutations: '++id, &client_mutation_id, sync_status, session_id',
			cached_session_bundles: '&session_id'
		});
		await legacyDb.open();
		const legacyRow = (cmid: string, guest: string | null, bib: number) => ({
			client_mutation_id: cmid,
			session_id: 1,
			mode_type: 'training',
			event_id: 10,
			bib_number: bib,
			score: 80,
			guest_identifier: guest,
			created_at_local: new Date().toISOString(),
			sync_status: 'pending',
			last_error: null,
			retry_count: 0
		});
		await legacyDb
			.table('pending_score_mutations')
			.bulkAdd([legacyRow('legacy-auth', null, 5), legacyRow('legacy-guest', 'G-legacy', 6)]);
		legacyDb.close();

		// v3 スキーマで開く → upgrade が走る
		const db = getOfflineDb();
		const authRow = await db.pending_score_mutations
			.where('client_mutation_id')
			.equals('legacy-auth')
			.first();
		const guestRow = await db.pending_score_mutations
			.where('client_mutation_id')
			.equals('legacy-guest')
			.first();

		// owner 判別不能な旧 auth pending → 「同期失敗」として表面化（永久 pending の滞留を防ぐ）
		expect(authRow?.sync_status).toBe('rejected');
		expect(authRow?.last_error).toBe('legacy_no_owner');
		// 旧 guest 行は owner_type を補完して通常どおり送信可能に
		expect(guestRow?.sync_status).toBe('pending');
		expect(guestRow?.owner_type).toBe('guest');
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

describe('リトライ上限による打ち切り（P2: 無限 pending の表面化）', () => {
	const authRejected = (id: string) =>
		okResponse({ accepted: [], rejected: [{ client_mutation_id: id, reason: 'auth_required' }] });

	it('サーバー拒否が失敗開始から6h継続し上限に達した mutation は rejected に落ちる', async () => {
		const saved = await enqueueScoreMutation(baseInput);
		// 失敗開始が7時間前、既に9回サーバー拒否済み（=次の1回で上限10到達）
		const firstReject = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
		await getOfflineDb().pending_score_mutations.update(saved.id!, {
			first_server_reject_at: firstReject,
			server_retry_count: 9
		});
		const fetchFn = vi.fn(async () => authRejected(saved.client_mutation_id));

		const result = await syncPendingMutations(fetchFn as unknown as typeof fetch);

		expect(result).toMatchObject({ synced: 0, rejected: 1, remaining: 0 });
		expect(await getRejectedCount()).toBe(1);
		expect(await getPendingCount()).toBe(0);
		const row = await getOfflineDb().pending_score_mutations.get(saved.id!);
		expect(row?.last_error).toBe('retry_exhausted:auth_required');
	});

	it('作成が古くても、サーバー拒否の開始から6h未満なら give-up しない（一過性障害でロストしない）', async () => {
		const saved = await enqueueScoreMutation(baseInput);
		// 3日前に作成された長期オフライン採点。だが失敗開始はまだ（first_server_reject_at=null）
		const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
		await getOfflineDb().pending_score_mutations.update(saved.id!, {
			created_at_local: old,
			server_retry_count: 50 // 回数だけは多い
		});
		const fetchFn = vi.fn(async () => authRejected(saved.client_mutation_id));

		const result = await syncPendingMutations(fetchFn as unknown as typeof fetch);

		// 失敗開始が今なので、作成が3日前でも give-up せず pending 維持
		expect(result).toMatchObject({ rejected: 0, remaining: 1 });
		expect(await getPendingCount()).toBe(1);
		const row = await getOfflineDb().pending_score_mutations.get(saved.id!);
		expect(row?.first_server_reject_at).toBeTruthy(); // 失敗開始が記録された
	});

	it('ネットワーク失敗（bumpRetry）では server_retry_count / first_server_reject_at を増やさず give-up の対象にしない', async () => {
		const saved = await enqueueScoreMutation(baseInput);
		const firstReject = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
		await getOfflineDb().pending_score_mutations.update(saved.id!, {
			first_server_reject_at: firstReject,
			server_retry_count: 9
		});
		const fetchFn = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});

		const result = await syncPendingMutations(fetchFn as unknown as typeof fetch);

		// 失敗開始が古くても回数上限でも、サーバー未到達（ネットワーク失敗）では落とさない
		expect(result).toMatchObject({ offline: true, remaining: 1 });
		expect(await getPendingCount()).toBe(1);
		const row = await getOfflineDb().pending_score_mutations.get(saved.id!);
		expect(row?.server_retry_count).toBe(9); // 据え置き
		expect(row?.sync_status).toBe('pending');
	});
});

describe('rependMismatchedMutations（P3: 再認証後の救済）', () => {
	async function seedRejected(overrides: Record<string, unknown>, bib = 5) {
		const saved = await enqueueScoreMutation({
			...baseInput,
			bib_number: bib,
			guest_identifier: 'G1'
		});
		await getOfflineDb().pending_score_mutations.update(saved.id!, {
			sync_status: 'rejected',
			last_error: 'guest_identity_mismatch',
			...overrides
		});
		return saved;
	}

	it('同一 guest の guest_identity_mismatch 拒否を pending に戻し、カウンタをリセットする', async () => {
		const saved = await seedRejected({ server_retry_count: 5 });
		expect(await getRejectedCount()).toBe(1);

		const n = await rependMismatchedMutations('G1');

		expect(n).toBe(1);
		expect(await getRejectedCount()).toBe(0);
		expect(await getPendingCount()).toBe(1);
		const row = await getOfflineDb().pending_score_mutations.get(saved.id!);
		expect(row?.last_error).toBeNull();
		expect(row?.server_retry_count).toBe(0);
		expect(row?.first_server_reject_at).toBeNull();
	});

	it('別 guest の拒否は対象外（再 pending しない）', async () => {
		await seedRejected({}); // guest_identifier G1
		const n = await rependMismatchedMutations('G2');
		expect(n).toBe(0);
		expect(await getRejectedCount()).toBe(1);
	});

	it('mismatch 以外の理由（例: mode_mismatch / retry_exhausted）は救済しない', async () => {
		await seedRejected({ last_error: 'mode_mismatch' }, 5);
		await seedRejected({ last_error: 'retry_exhausted:auth_required' }, 6);
		const n = await rependMismatchedMutations('G1');
		expect(n).toBe(0);
		expect(await getRejectedCount()).toBe(2);
	});

	it('空の guestIdentifier では何もしない', async () => {
		await seedRejected({});
		expect(await rependMismatchedMutations('')).toBe(0);
		expect(await getRejectedCount()).toBe(1);
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
	it('現在identityと一致しない mutation は送信しない', async () => {
		await enqueueScoreMutation({ ...baseInput, judge_id: 'user-1' });
		await enqueueScoreMutation({ ...baseInput, bib_number: 6, judge_id: 'user-2' });
		setCurrentSyncIdentity({ owner_type: 'auth', judge_id: 'user-1', guest_identifier: null });
		const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body));
			expect(body.mutations).toHaveLength(1);
			expect(body.mutations[0].judge_id).toBe('user-1');
			return okResponse({ accepted: [body.mutations[0].client_mutation_id], rejected: [] });
		});

		const result = await syncPendingMutations(fetchFn as unknown as typeof fetch);

		expect(result).toMatchObject({ synced: 1, remaining: 1 });
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

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
