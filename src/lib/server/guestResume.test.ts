import { describe, it, expect, vi, beforeEach } from 'vitest';
import { issueResumeToken, getResumeToken, findParticipantByResumeToken } from './guestResume';

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() }
}));

/**
 * guest_resume_tokens は service role 専用テーブル。ここでは supabaseAdmin の
 * チェーンをテーブル別に差し替えて、照合条件と戻り値の契約を固定する。
 */
function makeAdmin(handlers: Record<string, unknown>) {
	return {
		from: vi.fn((table: string) => handlers[table])
	} as never;
}

const selectChain = (result: { data: unknown; error: unknown }) => {
	const chain = {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		maybeSingle: vi.fn().mockResolvedValue(result)
	};
	return chain;
};

describe('guestResume', () => {
	beforeEach(() => vi.clearAllMocks());

	describe('getResumeToken', () => {
		it('発行済みなら token を返す', async () => {
			const chain = selectChain({ data: { token: 'tok-1' }, error: null });
			const admin = makeAdmin({ guest_resume_tokens: chain });

			await expect(getResumeToken(admin, 'participant-1')).resolves.toBe('tok-1');
			expect(chain.eq).toHaveBeenCalledWith('participant_id', 'participant-1');
		});

		it('未発行なら null を返す', async () => {
			const admin = makeAdmin({ guest_resume_tokens: selectChain({ data: null, error: null }) });
			await expect(getResumeToken(admin, 'participant-1')).resolves.toBeNull();
		});

		it('取得エラー時も throw せず null を返す', async () => {
			const admin = makeAdmin({
				guest_resume_tokens: selectChain({ data: null, error: { message: 'boom' } })
			});
			await expect(getResumeToken(admin, 'participant-1')).resolves.toBeNull();
		});
	});

	describe('issueResumeToken', () => {
		it('既に発行済みなら作り直さず既存 token を返す', async () => {
			const chain = {
				...selectChain({ data: { token: 'existing' }, error: null }),
				insert: vi.fn()
			};
			const admin = makeAdmin({ guest_resume_tokens: chain });

			await expect(issueResumeToken(admin, 'p-1')).resolves.toBe('existing');
			expect(chain.insert).not.toHaveBeenCalled();
		});

		it('未発行なら新しい token を insert して返す', async () => {
			const chain = {
				...selectChain({ data: null, error: null }),
				insert: vi.fn().mockResolvedValue({ error: null })
			};
			const admin = makeAdmin({ guest_resume_tokens: chain });

			const token = await issueResumeToken(admin, 'p-1');

			expect(typeof token).toBe('string');
			expect(token).not.toBe('');
			expect(chain.insert).toHaveBeenCalledWith(
				expect.objectContaining({ participant_id: 'p-1', token })
			);
		});

		it('insert 競合時は読み直した既存 token を返す', async () => {
			const maybeSingle = vi
				.fn()
				.mockResolvedValueOnce({ data: null, error: null }) // 発行前の確認
				.mockResolvedValueOnce({ data: { token: 'raced' }, error: null }); // 競合後の読み直し
			const chain = {
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				maybeSingle,
				insert: vi.fn().mockResolvedValue({ error: { message: 'duplicate key' } })
			};
			const admin = makeAdmin({ guest_resume_tokens: chain });

			await expect(issueResumeToken(admin, 'p-1')).resolves.toBe('raced');
		});
	});

	describe('findParticipantByResumeToken', () => {
		const participant = {
			id: 'p-1',
			session_id: 42,
			guest_identifier: 'gid-1',
			guest_name: 'ゲスト太郎',
			user_id: 'anon-1',
			is_guest: true
		};

		it('token が一致し session_id も一致すれば参加者を返す', async () => {
			const chain = selectChain({ data: { session_participants: participant }, error: null });
			const admin = makeAdmin({ guest_resume_tokens: chain });

			const found = await findParticipantByResumeToken(admin, '42', 'tok-1');

			expect(found).toEqual({
				id: 'p-1',
				session_id: 42,
				guest_identifier: 'gid-1',
				guest_name: 'ゲスト太郎',
				user_id: 'anon-1'
			});
			expect(chain.eq).toHaveBeenCalledWith('token', 'tok-1');
		});

		it('リレーションが配列で返っても解釈できる', async () => {
			const admin = makeAdmin({
				guest_resume_tokens: selectChain({
					data: { session_participants: [participant] },
					error: null
				})
			});
			const found = await findParticipantByResumeToken(admin, '42', 'tok-1');
			expect(found?.id).toBe('p-1');
		});

		it('❗ 別セッションの token では null（越境を拒否）', async () => {
			const admin = makeAdmin({
				guest_resume_tokens: selectChain({
					data: { session_participants: participant },
					error: null
				})
			});
			await expect(findParticipantByResumeToken(admin, '99', 'tok-1')).resolves.toBeNull();
		});

		it('❗ 未知の token では null', async () => {
			const admin = makeAdmin({ guest_resume_tokens: selectChain({ data: null, error: null }) });
			await expect(findParticipantByResumeToken(admin, '42', 'unknown')).resolves.toBeNull();
		});

		it('❗ 空文字の token は DB を引かずに null', async () => {
			const chain = selectChain({ data: null, error: null });
			const admin = makeAdmin({ guest_resume_tokens: chain });

			await expect(findParticipantByResumeToken(admin, '42', '')).resolves.toBeNull();
			expect(chain.select).not.toHaveBeenCalled();
		});

		it('❗ is_guest=false の行は null（ゲスト以外は復帰対象外）', async () => {
			const admin = makeAdmin({
				guest_resume_tokens: selectChain({
					data: { session_participants: { ...participant, is_guest: false } },
					error: null
				})
			});
			await expect(findParticipantByResumeToken(admin, '42', 'tok-1')).resolves.toBeNull();
		});
	});
});
