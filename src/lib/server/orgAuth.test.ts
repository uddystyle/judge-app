import { describe, it, expect, vi } from 'vitest';
import { getActiveOrgRole, isOrgAdmin } from './orgAuth';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeSupabase(result: { data: unknown; error: unknown }) {
	const chain = {
		select: vi.fn(),
		eq: vi.fn(),
		is: vi.fn(),
		single: vi.fn(async () => result)
	};
	chain.select.mockReturnValue(chain);
	chain.eq.mockReturnValue(chain);
	chain.is.mockReturnValue(chain);

	const supabase = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
	return { supabase, chain };
}

describe('getActiveOrgRole', () => {
	it('アクティブメンバーの role を返す', async () => {
		const { supabase } = makeSupabase({ data: { role: 'member' }, error: null });
		expect(await getActiveOrgRole(supabase, 'org-1', 'user-1')).toBe('member');
	});

	it('非メンバー（該当行なし）は null を返す', async () => {
		const { supabase } = makeSupabase({ data: null, error: { code: 'PGRST116' } });
		expect(await getActiveOrgRole(supabase, 'org-1', 'user-1')).toBeNull();
	});

	it('退会済みメンバーを除外するため必ず removed_at IS NULL で照会する', async () => {
		const { supabase, chain } = makeSupabase({ data: { role: 'admin' }, error: null });
		await getActiveOrgRole(supabase, 'org-1', 'user-1');

		expect(supabase.from).toHaveBeenCalledWith('organization_members');
		expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
		expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
		expect(chain.is).toHaveBeenCalledWith('removed_at', null);
	});
});

describe('isOrgAdmin', () => {
	it('admin なら true', async () => {
		const { supabase } = makeSupabase({ data: { role: 'admin' }, error: null });
		expect(await isOrgAdmin(supabase, 'org-1', 'user-1')).toBe(true);
	});

	it('member なら false', async () => {
		const { supabase } = makeSupabase({ data: { role: 'member' }, error: null });
		expect(await isOrgAdmin(supabase, 'org-1', 'user-1')).toBe(false);
	});

	it('非メンバーなら false', async () => {
		const { supabase } = makeSupabase({ data: null, error: { code: 'PGRST116' } });
		expect(await isOrgAdmin(supabase, 'org-1', 'user-1')).toBe(false);
	});
});
