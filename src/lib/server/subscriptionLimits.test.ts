import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	getUserPlanLimits,
	getCurrentMonthSessionCount,
	checkCanCreateSession,
	checkCanUseTournamentMode,
	checkCanUseTrainingMode,
	checkCanUseScoreboard,
	checkAthleteLimit,
	checkJudgeLimit,
	incrementSessionCount
} from './subscriptionLimits';
import { createMockSupabaseClient } from './test-utils';

describe('subscriptionLimits', () => {
	let mockSupabase: any;
	let mocks: any;

	beforeEach(() => {
		vi.clearAllMocks();
		const clientMock = createMockSupabaseClient();
		mockSupabase = clientMock.supabase;
		mocks = clientMock.mocks;
	});

	describe('getUserPlanLimits', () => {
		it('サブスクリプションが見つからない場合はフリープランを返す', async () => {
			mocks.single
				.mockResolvedValueOnce({
					data: null,
					error: { message: 'Not found' }
				})
				.mockResolvedValueOnce({
					data: null,
					error: { message: 'Plan limits not found' }
				});

			const result = await getUserPlanLimits(mockSupabase, 'user-123');

			expect(result.plan_type).toBe('free');
			expect(result.max_sessions_per_month).toBe(3);
		});

		it('ユーザーのプラン制限を正常に取得できる', async () => {
			const mockSubscription = { plan_type: 'basic' };
			const mockPlanLimits = {
				plan_type: 'basic',
				max_sessions_per_month: 10,
				max_athletes_per_session: 50,
				max_judges_per_session: 10,
				has_tournament_mode: true,
				has_training_mode: false,
				has_scoreboard: true,
				data_retention_months: 12
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await getUserPlanLimits(mockSupabase, 'user-123');

			expect(result).toEqual(mockPlanLimits);
		});

		it('プラン制限取得エラー時はフリープランの制限を返す', async () => {
			const mockSubscription = { plan_type: 'basic' };

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: null,
					error: { message: 'Plan limits not found' }
				});

			const result = await getUserPlanLimits(mockSupabase, 'user-123');

			expect(result.plan_type).toBe('free');
			expect(result.max_sessions_per_month).toBe(3);
			expect(result.max_athletes_per_session).toBe(30);
		});
	});

	describe('getCurrentMonthSessionCount', () => {
		it('今月のセッション数を正しくカウントする', async () => {
			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						gte: vi.fn().mockResolvedValue({
							count: 7,
							data: null,
							error: null
						})
					})
				})
			});

			const result = await getCurrentMonthSessionCount(mockSupabase, 'user-123');

			expect(result).toBe(7);
			expect(mocks.from).toHaveBeenCalledWith('sessions');
		});

		it('セッションが0件の場合は0を返す', async () => {
			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						gte: vi.fn().mockResolvedValue({
							count: null,
							data: null,
							error: null
						})
					})
				})
			});

			const result = await getCurrentMonthSessionCount(mockSupabase, 'user-123');

			expect(result).toBe(0);
		});
	});

	describe('checkCanCreateSession', () => {
		it('セッション数が上限に達している場合はfalseを返す', async () => {
			const mockSubscription = { plan_type: 'free' };
			const mockPlanLimits = {
				max_sessions_per_month: 3
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			mocks.from.mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			}).mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			}).mockReturnValueOnce({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						gte: vi.fn().mockResolvedValue({
							count: 3,
							data: null,
							error: null
						})
					})
				})
			});

			const result = await checkCanCreateSession(mockSupabase, 'user-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('今月のセッション数が上限');
			expect(result.upgradeUrl).toBe('/pricing');
		});

		it('セッション数が上限未満の場合はtrueを返す', async () => {
			const mockSubscription = { plan_type: 'basic' };
			const mockPlanLimits = {
				max_sessions_per_month: 10
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			mocks.from.mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			}).mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			}).mockReturnValueOnce({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						gte: vi.fn().mockResolvedValue({
							count: 5,
							data: null,
							error: null
						})
					})
				})
			});

			const result = await checkCanCreateSession(mockSupabase, 'user-123');

			expect(result.allowed).toBe(true);
		});

		it('無制限プラン(-1)の場合は常にtrueを返す', async () => {
			const mockSubscription = { plan_type: 'premium' };
			const mockPlanLimits = {
				max_sessions_per_month: -1
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanCreateSession(mockSupabase, 'user-123');

			expect(result.allowed).toBe(true);
		});
	});

	describe('checkCanUseTournamentMode', () => {
		it('大会モードが利用不可の場合はfalseを返す', async () => {
			const mockSubscription = { plan_type: 'free' };
			const mockPlanLimits = {
				has_tournament_mode: false
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanUseTournamentMode(mockSupabase, 'user-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('大会モードは有料プランでのみ利用できます。');
			expect(result.upgradeUrl).toBe('/pricing');
		});

		it('大会モードが利用可能な場合はtrueを返す', async () => {
			const mockSubscription = { plan_type: 'premium' };
			const mockPlanLimits = {
				has_tournament_mode: true
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanUseTournamentMode(mockSupabase, 'user-123');

			expect(result.allowed).toBe(true);
		});
	});

	describe('checkCanUseTrainingMode', () => {
		it('研修モードが利用不可の場合はfalseを返す', async () => {
			const mockSubscription = { plan_type: 'basic' };
			const mockPlanLimits = {
				has_training_mode: false
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanUseTrainingMode(mockSupabase, 'user-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('研修モードは有料プランでのみ利用できます。');
		});

		it('研修モードが利用可能な場合はtrueを返す', async () => {
			const mockSubscription = { plan_type: 'standard' };
			const mockPlanLimits = {
				has_training_mode: true
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanUseTrainingMode(mockSupabase, 'user-123');

			expect(result.allowed).toBe(true);
		});
	});

	describe('checkCanUseScoreboard', () => {
		it('スコアボードが利用不可の場合はfalseを返す', async () => {
			const mockSubscription = { plan_type: 'free' };
			const mockPlanLimits = {
				has_scoreboard: false
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanUseScoreboard(mockSupabase, 'user-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('スコアボード公開機能は有料プランでのみ利用できます。');
		});

		it('スコアボードが利用可能な場合はtrueを返す', async () => {
			const mockSubscription = { plan_type: 'basic' };
			const mockPlanLimits = {
				has_scoreboard: true
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanUseScoreboard(mockSupabase, 'user-123');

			expect(result.allowed).toBe(true);
		});
	});

	describe('checkAthleteLimit', () => {
		it('選手数が上限に達している場合はfalseを返す', async () => {
			const mockSubscription = { plan_type: 'free' };
			const mockPlanLimits = {
				max_athletes_per_session: 30
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkAthleteLimit(mockSupabase, 'user-123', 30);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('選手数が上限');
			expect(result.upgradeUrl).toBe('/pricing');
		});

		it('選手数が上限未満の場合はtrueを返す', async () => {
			const mockSubscription = { plan_type: 'basic' };
			const mockPlanLimits = {
				max_athletes_per_session: 50
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkAthleteLimit(mockSupabase, 'user-123', 25);

			expect(result.allowed).toBe(true);
		});

		it('無制限プラン(-1)の場合は常にtrueを返す', async () => {
			const mockSubscription = { plan_type: 'premium' };
			const mockPlanLimits = {
				max_athletes_per_session: -1
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkAthleteLimit(mockSupabase, 'user-123', 1000);

			expect(result.allowed).toBe(true);
		});
	});

	describe('checkJudgeLimit', () => {
		it('検定員数が上限に達している場合はfalseを返す', async () => {
			const mockSubscription = { plan_type: 'free' };
			const mockPlanLimits = {
				max_judges_per_session: 5
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkJudgeLimit(mockSupabase, 'user-123', 5);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('検定員数が上限');
		});

		it('検定員数が上限未満の場合はtrueを返す', async () => {
			const mockSubscription = { plan_type: 'basic' };
			const mockPlanLimits = {
				max_judges_per_session: 10
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkJudgeLimit(mockSupabase, 'user-123', 3);

			expect(result.allowed).toBe(true);
		});

		it('無制限プラン(-1)の場合は常にtrueを返す', async () => {
			const mockSubscription = { plan_type: 'premium' };
			const mockPlanLimits = {
				max_judges_per_session: -1
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockSubscription,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkJudgeLimit(mockSupabase, 'user-123', 100);

			expect(result.allowed).toBe(true);
		});
	});

	describe('incrementSessionCount', () => {
		it('既存のレコードがある場合は更新する', async () => {
			// 実装と同じロジックで現在の月を計算
			const currentMonth = new Date();
			currentMonth.setDate(1);
			const monthStr = currentMonth.toISOString().split('T')[0];

			const existingUsage = {
				user_id: 'user-123',
				month: monthStr,
				sessions_count: 5
			};

			mocks.single.mockResolvedValue({
				data: existingUsage,
				error: null
			});

			const mockUpdate = vi.fn().mockReturnThis();
			const mockEq1 = vi.fn().mockReturnThis();
			const mockEq2 = vi.fn().mockResolvedValue({
				data: null,
				error: null
			});

			// 2回のfrom呼び出し: 1) select+single, 2) update+eq+eq
			mocks.from.mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			}).mockReturnValueOnce({
				update: mockUpdate.mockReturnValue({
					eq: mockEq1.mockReturnValue({
						eq: mockEq2
					})
				})
			});

			await incrementSessionCount(mockSupabase, 'user-123');

			// 検証: usage_limitsテーブルが対象
			expect(mocks.from).toHaveBeenCalledWith('usage_limits');
			expect(mocks.from).toHaveBeenCalledTimes(2);

			// 検証: updateが sessions_count: 6 (5 + 1) で呼ばれた
			expect(mockUpdate).toHaveBeenCalledWith({ sessions_count: 6 });

			// 検証: eqが user_id と month で呼ばれた
			expect(mockEq1).toHaveBeenCalledWith('user_id', 'user-123');
			expect(mockEq2).toHaveBeenCalledWith('month', monthStr);
		});

		it('既存のレコードがない場合は新規作成する', async () => {
			mocks.single.mockResolvedValue({
				data: null,
				error: { message: 'Not found' }
			});

			const mockInsert = vi.fn().mockResolvedValue({
				data: null,
				error: null
			});

			// 実装と同じロジックで現在の月を計算
			const currentMonth = new Date();
			currentMonth.setDate(1);
			const monthStr = currentMonth.toISOString().split('T')[0];

			// 2回のfrom呼び出し: 1) select+single, 2) insert
			mocks.from.mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			}).mockReturnValueOnce({
				insert: mockInsert
			});

			await incrementSessionCount(mockSupabase, 'user-123');

			// 検証: usage_limitsテーブルが対象
			expect(mocks.from).toHaveBeenCalledWith('usage_limits');
			expect(mocks.from).toHaveBeenCalledTimes(2);

			// 検証: insertが正しいパラメータで呼ばれた
			expect(mockInsert).toHaveBeenCalledWith({
				user_id: 'user-123',
				month: monthStr,
				sessions_count: 1
			});
		});
	});
});
