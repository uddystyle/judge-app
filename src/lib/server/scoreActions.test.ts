import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteTrainingScore } from './scoreActions';

// Supabase モック
function createMockSupabase(options?: {
	deleteError?: { message: string } | null;
	profileResult?: { id: string } | null;
}) {
	const deleteChain = {
		eq: vi.fn().mockReturnThis(),
		then: vi.fn()
	};

	// delete() の最終結果
	const deleteResult = {
		error: options?.deleteError ?? null
	};

	// eq チェインの最後に Promise を返す
	let eqCallCount = 0;
	deleteChain.eq = vi.fn().mockImplementation(() => {
		eqCallCount++;
		// delete().eq(event_id).eq(athlete_id) で2回、+ 条件で3回
		// Promise.then で解決されるように thenable にする
		return {
			eq: deleteChain.eq,
			then: (resolve: any) => resolve(deleteResult)
		};
	});

	const fromMock = vi.fn().mockImplementation((table: string) => {
		if (table === 'training_scores') {
			return {
				delete: vi.fn().mockReturnValue({
					eq: deleteChain.eq
				})
			};
		}
		if (table === 'profiles') {
			return {
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: options?.profileResult ?? null,
							error: null
						})
					})
				})
			};
		}
		return {};
	});

	return { from: fromMock, _deleteChain: deleteChain, _eqCallCount: () => eqCallCount };
}

describe('deleteTrainingScore', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('guestIdentifier が指定されている場合、guest_identifier で削除する', async () => {
		const supabase = createMockSupabase();

		const result = await deleteTrainingScore(supabase as any, {
			eventId: 'event-1',
			athleteId: 'athlete-1',
			guestIdentifier: 'guest-abc',
			judgeId: null,
			judgeName: 'テスト検定員'
		});

		expect(result).toEqual({ success: true });
		// from('training_scores') が呼ばれた
		expect(supabase.from).toHaveBeenCalledWith('training_scores');
		// profiles テーブルは呼ばれない
		expect(supabase.from).not.toHaveBeenCalledWith('profiles');
	});

	it('judgeId が指定されている場合、judge_id で削除する', async () => {
		const supabase = createMockSupabase();

		const result = await deleteTrainingScore(supabase as any, {
			eventId: 'event-1',
			athleteId: 'athlete-1',
			guestIdentifier: null,
			judgeId: 'user-123',
			judgeName: 'テスト検定員'
		});

		expect(result).toEqual({ success: true });
		expect(supabase.from).toHaveBeenCalledWith('training_scores');
		expect(supabase.from).not.toHaveBeenCalledWith('profiles');
	});

	it('guestIdentifier も judgeId もない場合、judgeName から profiles を逆引きする', async () => {
		const supabase = createMockSupabase({
			profileResult: { id: 'resolved-user-id' }
		});

		const result = await deleteTrainingScore(supabase as any, {
			eventId: 'event-1',
			athleteId: 'athlete-1',
			guestIdentifier: null,
			judgeId: null,
			judgeName: '山田太郎'
		});

		expect(result).toEqual({ success: true });
		// profiles テーブルで逆引きが行われた
		expect(supabase.from).toHaveBeenCalledWith('profiles');
	});

	it('フォールバックで検定員が見つからない場合、エラーを返す', async () => {
		const supabase = createMockSupabase({
			profileResult: null
		});

		const result = await deleteTrainingScore(supabase as any, {
			eventId: 'event-1',
			athleteId: 'athlete-1',
			guestIdentifier: null,
			judgeId: null,
			judgeName: '存在しない検定員'
		});

		expect(result).toEqual({ success: false, error: '検定員が見つかりません。' });
	});

	it('削除でDBエラーが発生した場合、エラーを返す', async () => {
		const supabase = createMockSupabase({
			deleteError: { message: 'RLS policy violation' }
		});

		const result = await deleteTrainingScore(supabase as any, {
			eventId: 'event-1',
			athleteId: 'athlete-1',
			guestIdentifier: 'guest-abc',
			judgeId: null,
			judgeName: 'テスト検定員'
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain('得点の削除に失敗しました');
			expect(result.error).toContain('RLS policy violation');
		}
	});

	it('guestIdentifier が優先される（judgeId も存在する場合）', async () => {
		const supabase = createMockSupabase();

		const result = await deleteTrainingScore(supabase as any, {
			eventId: 'event-1',
			athleteId: 'athlete-1',
			guestIdentifier: 'guest-abc',
			judgeId: 'user-123',
			judgeName: 'テスト検定員'
		});

		expect(result).toEqual({ success: true });
		// profiles は呼ばれない（guestIdentifier が優先されるため）
		expect(supabase.from).not.toHaveBeenCalledWith('profiles');
	});
});
