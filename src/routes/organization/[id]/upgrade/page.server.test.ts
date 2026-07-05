import { describe, it, expect, vi, beforeEach } from 'vitest';
import { load } from './+page.server';

/** チェーン可能なクエリモック。single() / await のどちらでも result を返す */
function makeChain(result: unknown = { data: null, error: null }) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const c: any = {};
	for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
		c[m] = vi.fn(() => c);
	}
	c.single = vi.fn(async () => result);
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
		params: { id: 'org-1' },
		locals: { supabase }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any;

const orgChain = () =>
	makeChain({
		data: { id: 'org-1', name: 'Org', plan_type: 'free', stripe_customer_id: null },
		error: null
	});

describe('organization/[id]/upgrade load の管理者認可', () => {
	beforeEach(() => vi.clearAllMocks());

	it('管理者でないメンバーは 403 になる', async () => {
		const supabase = makeSupabase({
			organizations: [orgChain()],
			organization_members: [makeChain({ data: { role: 'member' }, error: null })]
		});

		await expect(load(makeEvent(supabase))).rejects.toMatchObject({ status: 403 });
	});

	it('非メンバーは 403 になる', async () => {
		const supabase = makeSupabase({
			organizations: [orgChain()],
			organization_members: [makeChain({ data: null, error: { code: 'PGRST116' } })]
		});

		await expect(load(makeEvent(supabase))).rejects.toMatchObject({ status: 403 });
	});

	it('退会済みメンバーを除外するため removed_at IS NULL で照会する（退会済み管理者の残留アクセス防止）', async () => {
		const membershipChain = makeChain({ data: { role: 'admin' }, error: null });
		const supabase = makeSupabase({
			organizations: [orgChain()],
			organization_members: [membershipChain],
			subscriptions: [makeChain({ data: null, error: null })],
			profiles: [makeChain({ data: { id: 'user-1', full_name: 'T' }, error: null })]
		});

		const result = await load(makeEvent(supabase));

		expect(membershipChain.is).toHaveBeenCalledWith('removed_at', null);
		expect(result).toMatchObject({ organization: { id: 'org-1' } });
	});
});
