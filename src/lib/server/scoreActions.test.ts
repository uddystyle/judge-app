import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteTrainingScore, resolveCorrectionOwner } from './scoreActions';

// Supabase モック
function createMockSupabase(options?: {
	deleteError?: { message: string } | null;
	profileResult?: { id: string } | null;
	deletedCount?: number | null;
}) {
	const deleteChain = {
		eq: vi.fn().mockReturnThis(),
		then: vi.fn()
	};

	// delete().select() の最終結果。count は 0 件検知（サイレント成功の防止）に使う
	const deleteResult = {
		error: options?.deleteError ?? null,
		count: options?.deletedCount === undefined ? 1 : options.deletedCount
	};

	// eq チェインの最後に select() を生やす
	let eqCallCount = 0;
	deleteChain.eq = vi.fn().mockImplementation(() => {
		eqCallCount++;
		// delete().eq(event_id).eq(athlete_id) で2回、+ 条件で3回
		return {
			eq: deleteChain.eq,
			select: vi.fn().mockResolvedValue(deleteResult)
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
			// 生の DB エラーメッセージはクライアントに漏らさない（info-disclosure 対策）
			expect(result.error).not.toContain('RLS policy violation');
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

describe('deleteTrainingScore の 0 件検知', () => {
	it('❗ RLS 等で 0 行しか消えなかった場合は失敗を返す（サイレント成功の防止）', async () => {
		const supabase = createMockSupabase({ deletedCount: 0 });

		const result = await deleteTrainingScore(supabase as any, {
			eventId: 'event-1',
			athleteId: 'athlete-1',
			judgeId: 'user-123',
			judgeName: 'テスト検定員'
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain('0件');
		}
	});

	it('count が null（取得できない）でも失敗として扱う', async () => {
		const supabase = createMockSupabase({ deletedCount: null });

		const result = await deleteTrainingScore(supabase as any, {
			eventId: 'event-1',
			athleteId: 'athlete-1',
			judgeId: 'user-123',
			judgeName: 'テスト検定員'
		});

		expect(result.success).toBe(false);
	});
});

describe('resolveCorrectionOwner（修正要求の owner 決定）', () => {
	const authedCaller = {
		user: { id: 'judge-self' },
		guestParticipant: null,
		guestIdentifier: null
	} as never;

	const guestCaller = {
		user: { id: 'anon-1' },
		guestParticipant: { guest_identifier: 'guest-self' },
		guestIdentifier: 'guest-self'
	} as never;

	it('主任はフォームで指定された owner を対象にできる（他検定員の修正は主任の職務）', () => {
		expect(
			resolveCorrectionOwner(authedCaller, true, {
				judgeId: 'other-judge',
				guestIdentifier: null
			})
		).toEqual({ judgeId: 'other-judge', guestIdentifier: null });

		expect(
			resolveCorrectionOwner(authedCaller, true, {
				judgeId: null,
				guestIdentifier: 'other-guest'
			})
		).toEqual({ judgeId: null, guestIdentifier: 'other-guest' });
	});

	it('❗ 主任以外は、フォームが他人を指していても自分の owner に強制される（認証審判）', () => {
		expect(
			resolveCorrectionOwner(authedCaller, false, {
				judgeId: 'victim-judge',
				guestIdentifier: 'victim-guest'
			})
		).toEqual({ judgeId: 'judge-self', guestIdentifier: null });
	});

	it('❗ 主任以外は、フォームが他人を指していても自分の owner に強制される（ゲスト）', () => {
		expect(
			resolveCorrectionOwner(guestCaller, false, {
				judgeId: 'victim-judge',
				guestIdentifier: 'victim-guest'
			})
		).toEqual({ judgeId: null, guestIdentifier: 'guest-self' });
	});

	it('主任が owner 未指定なら judge_name 後方互換のため両方 null を返す', () => {
		expect(
			resolveCorrectionOwner(authedCaller, true, { judgeId: '', guestIdentifier: '' })
		).toEqual({ judgeId: null, guestIdentifier: null });
	});
});
