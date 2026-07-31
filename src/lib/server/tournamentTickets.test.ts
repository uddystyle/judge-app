import { describe, it, expect, vi } from 'vitest';
import { countAvailableTickets } from './tournamentTickets';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeSupabase(result: { count: number | null; error: unknown }) {
	const chain = {
		select: vi.fn(),
		eq: vi.fn(),
		is: vi.fn(async () => result)
	};
	chain.select.mockReturnValue(chain);
	chain.eq.mockReturnValue(chain);

	return { supabase: { from: vi.fn(() => chain) } as unknown as SupabaseClient, chain };
}

describe('countAvailableTickets', () => {
	it('未使用チケット数を返す（used_at IS NULL で絞る）', async () => {
		const { supabase, chain } = makeSupabase({ count: 2, error: null });

		const count = await countAvailableTickets(supabase, 'org-1');

		expect(count).toBe(2);
		expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
		expect(chain.is).toHaveBeenCalledWith('used_at', null);
	});

	it('0枚なら 0 を返す', async () => {
		const { supabase } = makeSupabase({ count: 0, error: null });
		expect(await countAvailableTickets(supabase, 'org-1')).toBe(0);
	});

	it('取得エラー時は 0 を返す（最終判定は DB トリガーが行うため安全側）', async () => {
		const { supabase } = makeSupabase({ count: null, error: { message: 'relation not found' } });
		expect(await countAvailableTickets(supabase, 'org-1')).toBe(0);
	});
});
