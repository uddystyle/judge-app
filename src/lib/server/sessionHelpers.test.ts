/**
 * sessionHelpers.fetchActivePrompt テスト
 *
 * 複数審判モードの「主任が指定した bib のみ採点可」(#4) と finalizeScore の冪等クリア(#3)が
 * 依存する、active prompt 取得ロジックを検証する。
 */

import { describe, it, expect, vi } from 'vitest';
import { fetchActivePrompt } from './sessionHelpers';

function createMockSupabase(opts: { sessionData?: any; promptData?: any }) {
	const from = vi.fn((table: string) => {
		if (table === 'sessions') {
			return {
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({ data: opts.sessionData ?? null, error: null })
					})
				})
			};
		}
		if (table === 'scoring_prompts') {
			return {
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({ data: opts.promptData ?? null, error: null })
					})
				})
			};
		}
		return {};
	});
	return { from };
}

describe('fetchActivePrompt', () => {
	it('active_prompt_id が無ければ null を返し、scoring_prompts は引かない', async () => {
		const supabase = createMockSupabase({ sessionData: { active_prompt_id: null } });
		const result = await fetchActivePrompt(supabase as any, '1');
		expect(result).toBeNull();
		expect(supabase.from).toHaveBeenCalledWith('sessions');
		expect(supabase.from).not.toHaveBeenCalledWith('scoring_prompts');
	});

	it('sessions 行が無ければ null を返す', async () => {
		const supabase = createMockSupabase({ sessionData: null });
		expect(await fetchActivePrompt(supabase as any, '1')).toBeNull();
	});

	it('active prompt があれば prompt を返す', async () => {
		const prompt = { id: 'p1', bib_number: 5, level: '10', discipline: 'training' };
		const supabase = createMockSupabase({
			sessionData: { active_prompt_id: 'p1' },
			promptData: prompt
		});
		const result = await fetchActivePrompt(supabase as any, '1');
		expect(result).toEqual(prompt);
		expect(supabase.from).toHaveBeenCalledWith('scoring_prompts');
	});

	it('active_prompt_id はあるが prompt 行が無ければ null を返す', async () => {
		const supabase = createMockSupabase({
			sessionData: { active_prompt_id: 'p1' },
			promptData: null
		});
		expect(await fetchActivePrompt(supabase as any, '1')).toBeNull();
	});
});
