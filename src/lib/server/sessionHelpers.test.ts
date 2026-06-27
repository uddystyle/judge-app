/**
 * sessionHelpers.fetchActivePrompt テスト
 *
 * 複数審判モードの「主任が指定した bib のみ採点可」(#4) と finalizeScore の冪等クリア(#3)が
 * 依存する、active prompt 取得ロジックを検証する。
 */

import { describe, it, expect, vi } from 'vitest';
import { fetchActivePrompt, isJudgeNameTakenInSession } from './sessionHelpers';

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

function mockSupabaseForNameCheck(opts: { participants?: any[]; profiles?: any[] }) {
	const from = vi.fn((table: string) => {
		if (table === 'session_participants') {
			return {
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockResolvedValue({ data: opts.participants ?? [], error: null })
				})
			};
		}
		if (table === 'profiles') {
			return {
				select: vi.fn().mockReturnValue({
					in: vi.fn().mockResolvedValue({ data: opts.profiles ?? [], error: null })
				})
			};
		}
		return {};
	});
	return { from };
}

describe('isJudgeNameTakenInSession', () => {
	it('既存ゲスト名と一致すれば true（完全一致）', async () => {
		const supabase = mockSupabaseForNameCheck({
			participants: [{ is_guest: true, guest_name: '田中', user_id: null }]
		});
		expect(await isJudgeNameTakenInSession(supabase as any, 1, '田中')).toBe(true);
	});

	it('前後空白・大文字小文字を無視して一致判定する', async () => {
		const supabase = mockSupabaseForNameCheck({
			participants: [{ is_guest: true, guest_name: 'Tanaka', user_id: null }]
		});
		expect(await isJudgeNameTakenInSession(supabase as any, 1, '  tanaka  ')).toBe(true);
	});

	it('認証メンバーの profiles.full_name と一致すれば true（ゲストのなりすまし防止）', async () => {
		const supabase = mockSupabaseForNameCheck({
			participants: [{ is_guest: false, guest_name: null, user_id: 'u1' }],
			profiles: [{ full_name: '山田太郎' }]
		});
		expect(await isJudgeNameTakenInSession(supabase as any, 1, '山田太郎')).toBe(true);
	});

	it('一致しなければ false', async () => {
		const supabase = mockSupabaseForNameCheck({
			participants: [{ is_guest: true, guest_name: '田中', user_id: null }],
			profiles: [{ full_name: '山田太郎' }]
		});
		expect(await isJudgeNameTakenInSession(supabase as any, 1, '佐藤')).toBe(false);
	});

	it('空の候補名は false（参加者照合もしない）', async () => {
		const supabase = mockSupabaseForNameCheck({ participants: [] });
		expect(await isJudgeNameTakenInSession(supabase as any, 1, '   ')).toBe(false);
		expect(supabase.from).not.toHaveBeenCalled();
	});

	it('guest_name が null の参加者は誤一致しない', async () => {
		const supabase = mockSupabaseForNameCheck({
			participants: [{ is_guest: true, guest_name: null, user_id: null }]
		});
		expect(await isJudgeNameTakenInSession(supabase as any, 1, '田中')).toBe(false);
	});
});
