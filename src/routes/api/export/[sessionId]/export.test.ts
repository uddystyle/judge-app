import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';

/**
 * エクスポート API のテスト
 *
 * 回帰バグの再発防止: orgAuth 集約時にデバッグログが削除済み変数 membership を
 * 参照したまま残り、組織セッションのエクスポートが常に ReferenceError → 500 になっていた。
 */

/** チェーン可能なクエリモック */
function makeChain(result: unknown = { data: null, error: null }) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const c: any = {};
	for (const m of ['select', 'eq', 'neq', 'is', 'in', 'order', 'limit']) {
		c[m] = vi.fn(() => c);
	}
	c.single = vi.fn(async () => result);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	c.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
	return c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSupabase(queues: Record<string, any[]>) {
	return {
		auth: {
			getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }))
		},
		from: vi.fn((table: string) => {
			const q = queues[table];
			if (!q || q.length === 0) throw new Error(`unexpected from(${table})`);
			return q.length > 1 ? q.shift() : q[0];
		})
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeEvent = (supabase: any) =>
	({
		params: { sessionId: '1' },
		request: new Request('http://localhost/api/export/1'),
		locals: { supabase }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any;

const resultRows = [
	{
		created_at: '2026-07-01T00:00:00Z',
		bib: 1,
		score: 80,
		discipline: '基礎',
		level: '1級',
		event_name: '大回り',
		judge_name: '検定 太郎'
	}
];

beforeEach(() => vi.clearAllMocks());

describe('GET /api/export/[sessionId]', () => {
	it('組織セッションで作成者かつ組織メンバーならエクスポートできる（回帰防止）', async () => {
		const supabase = makeSupabase({
			sessions: [
				makeChain({
					data: {
						created_by: 'user-1',
						mode: 'certification',
						is_tournament_mode: false,
						organization_id: 'org-1'
					},
					error: null
				})
			],
			organization_members: [makeChain({ data: { role: 'member' }, error: null })],
			results: [makeChain({ data: resultRows, error: null })]
		});

		const res = await GET(makeEvent(supabase));

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ results: resultRows });
	});

	it('組織なしセッション（organization_id null）でもエクスポートできる', async () => {
		const supabase = makeSupabase({
			sessions: [
				makeChain({
					data: {
						created_by: 'user-1',
						mode: 'certification',
						is_tournament_mode: false,
						organization_id: null
					},
					error: null
				})
			],
			results: [makeChain({ data: resultRows, error: null })]
		});

		const res = await GET(makeEvent(supabase));

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ results: resultRows });
	});

	it('作成者以外は 403', async () => {
		const supabase = makeSupabase({
			sessions: [
				makeChain({
					data: {
						created_by: 'other',
						mode: 'certification',
						is_tournament_mode: false,
						organization_id: 'org-1'
					},
					error: null
				})
			]
		});

		await expect(GET(makeEvent(supabase))).rejects.toMatchObject({ status: 403 });
	});

	it('退会済み・非メンバーは 403', async () => {
		const supabase = makeSupabase({
			sessions: [
				makeChain({
					data: {
						created_by: 'user-1',
						mode: 'certification',
						is_tournament_mode: false,
						organization_id: 'org-1'
					},
					error: null
				})
			],
			organization_members: [makeChain({ data: null, error: { code: 'PGRST116' } })]
		});

		await expect(GET(makeEvent(supabase))).rejects.toMatchObject({ status: 403 });
	});
});
