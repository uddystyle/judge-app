import { describe, it, expect, vi, beforeEach } from 'vitest';
import { joinOrRestoreMember } from './orgMembership';

/**
 * 退会済みメンバーの再参加。
 *
 * ⚠️ organization_members には UNIQUE (organization_id, user_id) がある。
 * 退会は removed_at を立てる論理削除なので、行は残ったままになる。
 * そのため再参加を単純な INSERT で行うと**一意制約違反で必ず失敗する**。
 * 既存の復元 API（members/[memberId] の PATCH）と同じく UPDATE で復帰させる。
 *
 * ⚠️ 復帰時の role は招待側の指定に従う（＝退会前の role を復活させない）。
 * UPDATE で role を触らないと、**admin だった人が招待リンク経由で admin として戻る**。
 * 招待した側は一般メンバーを招いたつもりでも管理者権限が付いてしまう。
 */

type Row = { id: string; role: string; removed_at: string | null } | null;

function createSupabase(existing: Row) {
	const updates: Array<Record<string, unknown>> = [];
	const inserts: Array<Record<string, unknown>> = [];

	const client = {
		from: vi.fn(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const q: any = {};
			Object.assign(q, {
				select: vi.fn(() => q),
				eq: vi.fn(() => q),
				maybeSingle: vi.fn(async () => ({ data: existing, error: null })),
				update: vi.fn((v: Record<string, unknown>) => {
					updates.push(v);
					return q;
				}),
				insert: vi.fn(async (v: Record<string, unknown>) => {
					inserts.push(v);
					return { error: null };
				}),
				then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r)
			});
			return q;
		})
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { client: client as any, updates, inserts };
}

describe('joinOrRestoreMember', () => {
	beforeEach(() => vi.clearAllMocks());

	it('初参加なら INSERT する', async () => {
		const { client, inserts, updates } = createSupabase(null);

		const result = await joinOrRestoreMember(client, {
			organizationId: 'org-1',
			userId: 'user-1',
			role: 'member'
		});

		expect(result).toMatchObject({ ok: true, restored: false });
		expect(inserts).toHaveLength(1);
		expect(inserts[0]).toMatchObject({
			organization_id: 'org-1',
			user_id: 'user-1',
			role: 'member'
		});
		expect(updates).toHaveLength(0);
	});

	it('退会済みなら INSERT せず UPDATE で復帰させる（一意制約違反を避ける）', async () => {
		const { client, inserts, updates } = createSupabase({
			id: 'm-1',
			role: 'admin',
			removed_at: '2026-01-01T00:00:00Z'
		});

		const result = await joinOrRestoreMember(client, {
			organizationId: 'org-1',
			userId: 'user-1',
			role: 'member'
		});

		expect(result).toMatchObject({ ok: true, restored: true });
		expect(inserts).toHaveLength(0);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({ removed_at: null, removed_by: null });
	});

	it('復帰時の role は招待側の指定に従う（退会前の admin を復活させない）', async () => {
		const { client, updates } = createSupabase({
			id: 'm-1',
			role: 'admin',
			removed_at: '2026-01-01T00:00:00Z'
		});

		await joinOrRestoreMember(client, {
			organizationId: 'org-1',
			userId: 'user-1',
			role: 'member'
		});

		expect(updates[0]).toMatchObject({ role: 'member' });
	});

	it('joined_at は触らない（既存の復元 API と揃える）', async () => {
		const { client, updates } = createSupabase({
			id: 'm-1',
			role: 'member',
			removed_at: '2026-01-01T00:00:00Z'
		});

		await joinOrRestoreMember(client, {
			organizationId: 'org-1',
			userId: 'user-1',
			role: 'member'
		});

		expect(updates[0]).not.toHaveProperty('joined_at');
	});

	it('在籍中なら何もせず alreadyMember を返す', async () => {
		const { client, inserts, updates } = createSupabase({
			id: 'm-1',
			role: 'member',
			removed_at: null
		});

		const result = await joinOrRestoreMember(client, {
			organizationId: 'org-1',
			userId: 'user-1',
			role: 'member'
		});

		expect(result).toMatchObject({ ok: false, alreadyMember: true });
		expect(inserts).toHaveLength(0);
		expect(updates).toHaveLength(0);
	});
});
