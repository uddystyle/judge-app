import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * org-admin 認可を持つ API エンドポイントの characterization テスト
 * （orgAuth ヘルパーへの集約リファクタリングの前後で挙動が変わらないことを固定する）
 *
 * 対象: members/[memberId] DELETE・POST、sessions/[id] DELETE・POST、
 * sessions/[id]/permanent DELETE の認可パス（非メンバー 403 / 非管理者 403）。
 */

import {
	DELETE as deleteMember,
	POST as restoreMember
} from '../../../routes/api/organization/[id]/members/[memberId]/+server';
import {
	DELETE as deleteSession,
	POST as restoreSession
} from '../../../routes/api/sessions/[id]/+server';
import { DELETE as permanentDeleteSession } from '../../../routes/api/sessions/[id]/permanent/+server';

/** チェーン可能なクエリモック。single() / await のどちらでも result を返す */
function makeChain(result: unknown = { data: null, error: null }) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const c: any = {};
	for (const m of [
		'select',
		'eq',
		'neq',
		'is',
		'not',
		'order',
		'limit',
		'update',
		'delete',
		'insert'
	]) {
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
		params: { id: '1', memberId: 'm1' },
		request: new Request('http://localhost/api/test', { method: 'POST' }),
		locals: { supabase }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any;

// 非メンバー（該当行なし）を表す membership チェーン
const noMembership = () => makeChain({ data: null, error: { code: 'PGRST116' } });
// 一般メンバーを表す membership チェーン
const memberMembership = () => makeChain({ data: { role: 'member' }, error: null });

describe('organization/[id]/members/[memberId]', () => {
	beforeEach(() => vi.clearAllMocks());

	describe.each([
		['DELETE', deleteMember],
		['POST(restore)', restoreMember]
	] as const)('%s', (_name, handler) => {
		it('非メンバーは 403「この組織のメンバーではありません」', async () => {
			const supabase = makeSupabase({ organization_members: [noMembership()] });
			const res = await handler(makeEvent(supabase));
			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({ error: 'この組織のメンバーではありません' });
		});

		it('一般メンバーは 403「管理者権限が必要です」', async () => {
			const supabase = makeSupabase({ organization_members: [memberMembership()] });
			const res = await handler(makeEvent(supabase));
			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({ error: '管理者権限が必要です' });
		});
	});
});

describe('sessions/[id]', () => {
	beforeEach(() => vi.clearAllMocks());

	const sessionRow = { data: { id: 1, organization_id: 'org-1', name: 'S' }, error: null };

	describe.each([
		['DELETE', deleteSession],
		['POST(restore)', restoreSession]
	] as const)('%s', (_name, handler) => {
		it('非メンバーは 403「この組織のメンバーではありません」', async () => {
			const supabase = makeSupabase({
				sessions: [makeChain(sessionRow)],
				organization_members: [noMembership()]
			});
			const res = await handler(makeEvent(supabase));
			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({ error: 'この組織のメンバーではありません' });
		});

		it('一般メンバーは 403「管理者権限が必要です」', async () => {
			const supabase = makeSupabase({
				sessions: [makeChain(sessionRow)],
				organization_members: [memberMembership()]
			});
			const res = await handler(makeEvent(supabase));
			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({ error: '管理者権限が必要です' });
		});
	});
});

describe('sessions/[id]/permanent DELETE', () => {
	beforeEach(() => vi.clearAllMocks());

	const queues = () => ({
		sessions: [makeChain({ data: { id: 1, organization_id: 'org-1', name: 'S' }, error: null })],
		organizations: [makeChain({ data: { plan_type: 'premium' }, error: null })]
	});

	it('非メンバーは 403「この組織のメンバーではありません」', async () => {
		const supabase = makeSupabase({ ...queues(), organization_members: [noMembership()] });
		const res = await permanentDeleteSession(makeEvent(supabase));
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'この組織のメンバーではありません' });
	});

	it('一般メンバーは 403「管理者権限が必要です」', async () => {
		const supabase = makeSupabase({ ...queues(), organization_members: [memberMembership()] });
		const res = await permanentDeleteSession(makeEvent(supabase));
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: '管理者権限が必要です' });
	});
});
