import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	getOrganizationPlanLimits,
	getCurrentMonthSessionCount,
	checkCanAddMember,
	checkCanCreateSession,
	checkCanUseTournamentMode,
	checkCanUseTrainingMode,
	checkCanAddJudgeToSession,
	checkCanUseScoreboard
} from './organizationLimits';
import { createMockSupabaseClient } from './test-utils';

describe('organizationLimits', () => {
	let mockSupabase: any;
	let mocks: any;

	beforeEach(() => {
		vi.clearAllMocks();
		const clientMock = createMockSupabaseClient();
		mockSupabase = clientMock.supabase;
		mocks = clientMock.mocks;
	});

	describe('getOrganizationPlanLimits', () => {
		it('組織が見つからない場合はnullを返す', async () => {
			mocks.single.mockResolvedValue({
				data: null,
				error: { message: 'Not found' }
			});

			const result = await getOrganizationPlanLimits(mockSupabase, 'org-123');

			expect(result).toBeNull();
			expect(mocks.from).toHaveBeenCalledWith('organizations');
			expect(mocks.select).toHaveBeenCalledWith('plan_type');
			expect(mocks.eq).toHaveBeenCalledWith('id', 'org-123');
		});

		it('プラン制限を正常に取得できる', async () => {
			const mockOrganization = { plan_type: 'basic' };
			const mockPlanLimits = {
				plan_type: 'basic',
				max_sessions_per_month: 10,
				max_athletes_per_session: 50,
				max_judges_per_session: 10,
				max_organization_members: 10,
				has_tournament_mode: true,
				has_training_mode: false,
				has_scoreboard: true,
				data_retention_months: 12
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await getOrganizationPlanLimits(mockSupabase, 'org-123');

			expect(result).toEqual(mockPlanLimits);
		});

		it('プラン制限取得エラー時はフリープランの制限を返す', async () => {
			const mockOrganization = { plan_type: 'basic' };

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
					error: null
				})
				.mockResolvedValueOnce({
					data: null,
					error: { message: 'Plan limits not found' }
				});

			const result = await getOrganizationPlanLimits(mockSupabase, 'org-123');

			expect(result).toEqual({
				plan_type: 'free',
				max_sessions_per_month: 3,
				max_athletes_per_session: -1,
				max_judges_per_session: 3,
				max_organization_members: 1,
				has_tournament_mode: false,
				has_training_mode: false,
				has_scoreboard: false,
				data_retention_months: 3
			});
		});
	});

	describe('getCurrentMonthSessionCount', () => {
		it('今月のセッション数を正しくカウントする', async () => {
			mocks.from.mockReturnValue({
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

			const result = await getCurrentMonthSessionCount(mockSupabase, 'org-123');

			expect(result).toBe(5);
		});

		it('セッションが0件の場合は0を返す', async () => {
			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						gte: vi.fn().mockResolvedValue({
							count: 0,
							data: null,
							error: null
						})
					})
				})
			});

			const result = await getCurrentMonthSessionCount(mockSupabase, 'org-123');

			expect(result).toBe(0);
		});
	});

	describe('checkCanAddMember', () => {
		it('組織情報が取得できない場合はfalseを返す', async () => {
			mocks.single.mockResolvedValue({
				data: null,
				error: { message: 'Not found' }
			});

			const result = await checkCanAddMember(mockSupabase, 'org-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('組織情報の取得に失敗しました。');
		});

		it('メンバー数が上限に達している場合はfalseを返す', async () => {
			const mockOrganization = { plan_type: 'basic' };
			const mockPlanLimits = {
				max_organization_members: 10
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
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
					eq: vi.fn().mockResolvedValue({
						count: 10,
						data: null,
						error: null
					})
				})
			});

			const result = await checkCanAddMember(mockSupabase, 'org-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('組織メンバー数の上限');
			expect(result.upgradeUrl).toBe('/settings/billing');
		});

		it('メンバー数が上限未満の場合はtrueを返す', async () => {
			const mockOrganization = { plan_type: 'basic' };
			const mockPlanLimits = {
				max_organization_members: 10
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
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
					eq: vi.fn().mockResolvedValue({
						count: 5,
						data: null,
						error: null
					})
				})
			});

			const result = await checkCanAddMember(mockSupabase, 'org-123');

			expect(result.allowed).toBe(true);
		});

		it('無制限プラン(-1)の場合は常にtrueを返す', async () => {
			const mockOrganization = { plan_type: 'premium' };
			const mockPlanLimits = {
				max_organization_members: -1
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanAddMember(mockSupabase, 'org-123');

			expect(result.allowed).toBe(true);
		});
	});

	describe('checkCanCreateSession', () => {
		it('組織情報が取得できない場合はfalseを返す', async () => {
			mocks.single.mockResolvedValue({
				data: null,
				error: { message: 'Not found' }
			});

			const result = await checkCanCreateSession(mockSupabase, 'org-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('組織情報の取得に失敗しました。');
		});

		it('セッション数が上限に達している場合はfalseを返す', async () => {
			const mockOrganization = { plan_type: 'basic' };
			const mockPlanLimits = {
				max_sessions_per_month: 10
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
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
							count: 10,
							data: null,
							error: null
						})
					})
				})
			});

			const result = await checkCanCreateSession(mockSupabase, 'org-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('今月のセッション数が上限');
			expect(result.upgradeUrl).toBe('/settings/billing');
		});

		it('無制限プラン(-1)の場合は常にtrueを返す', async () => {
			const mockOrganization = { plan_type: 'premium' };
			const mockPlanLimits = {
				max_sessions_per_month: -1
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanCreateSession(mockSupabase, 'org-123');

			expect(result.allowed).toBe(true);
		});
	});

	describe('checkCanUseTournamentMode', () => {
		it('大会モードが利用不可の場合はfalseを返す', async () => {
			const mockOrganization = { plan_type: 'basic' };
			const mockPlanLimits = {
				has_tournament_mode: false
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanUseTournamentMode(mockSupabase, 'org-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('大会モードは有料プランでのみ利用できます。');
			expect(result.upgradeUrl).toBe('/settings/billing');
		});

		it('大会モードが利用可能な場合はtrueを返す', async () => {
			const mockOrganization = { plan_type: 'premium' };
			const mockPlanLimits = {
				has_tournament_mode: true
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanUseTournamentMode(mockSupabase, 'org-123');

			expect(result.allowed).toBe(true);
		});
	});

	describe('checkCanUseTrainingMode', () => {
		it('研修モードが利用不可の場合はfalseを返す', async () => {
			const mockOrganization = { plan_type: 'basic' };
			const mockPlanLimits = {
				has_training_mode: false
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanUseTrainingMode(mockSupabase, 'org-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('研修モードは有料プランでのみ利用できます。');
		});

		it('研修モードが利用可能な場合はtrueを返す', async () => {
			const mockOrganization = { plan_type: 'premium' };
			const mockPlanLimits = {
				has_training_mode: true
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanUseTrainingMode(mockSupabase, 'org-123');

			expect(result.allowed).toBe(true);
		});
	});

	describe('checkCanUseScoreboard', () => {
		it('スコアボードが利用不可の場合はfalseを返す', async () => {
			const mockOrganization = { plan_type: 'free' };
			const mockPlanLimits = {
				has_scoreboard: false
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanUseScoreboard(mockSupabase, 'org-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('スコアボード公開機能は有料プランでのみ利用できます。');
		});

		it('スコアボードが利用可能な場合はtrueを返す', async () => {
			const mockOrganization = { plan_type: 'basic' };
			const mockPlanLimits = {
				has_scoreboard: true
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			const result = await checkCanUseScoreboard(mockSupabase, 'org-123');

			expect(result.allowed).toBe(true);
		});
	});

	describe('checkCanAddJudgeToSession', () => {
		it('セッション情報が取得できない場合はfalseを返す', async () => {
			mocks.maybeSingle.mockResolvedValue({
				data: null,
				error: { message: 'Session not found' }
			});

			mocks.from.mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				maybeSingle: mocks.maybeSingle
			});

			const result = await checkCanAddJudgeToSession(mockSupabase, 'session-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toBe('セッション情報の取得に失敗しました。Session not found');
		});

		it('検定員数が上限に達している場合はfalseを返す', async () => {
			const mockSession = { organization_id: 'org-123' };
			const mockOrganization = { plan_type: 'basic' };
			const mockPlanLimits = {
				max_judges_per_session: 5
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			// 4回のfrom呼び出し: 1) sessions (maybeSingle), 2-3) getOrganizationPlanLimits (single), 4) session_participants (count)
			mocks.from.mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				maybeSingle: mocks.maybeSingle
			}).mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			}).mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			}).mockReturnValueOnce({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockResolvedValue({
						count: 5,
						data: null,
						error: null
					})
				})
			});

			mocks.maybeSingle.mockResolvedValueOnce({
				data: mockSession,
				error: null
			});

			const result = await checkCanAddJudgeToSession(mockSupabase, 'session-123');

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('セッションの検定員数上限');
		});

		it('無制限プランの場合は常にtrueを返す', async () => {
			const mockSession = { organization_id: 'org-123' };
			const mockOrganization = { plan_type: 'premium' };
			const mockPlanLimits = {
				max_judges_per_session: -1
			};

			mocks.single
				.mockResolvedValueOnce({
					data: mockOrganization,
					error: null
				})
				.mockResolvedValueOnce({
					data: mockPlanLimits,
					error: null
				});

			mocks.maybeSingle.mockResolvedValueOnce({
				data: mockSession,
				error: null
			});

			// 3回のfrom呼び出し: 1) sessions (maybeSingle), 2-3) getOrganizationPlanLimits (single)
			mocks.from.mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				maybeSingle: mocks.maybeSingle
			}).mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			}).mockReturnValueOnce({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			});

			const result = await checkCanAddJudgeToSession(mockSupabase, 'session-123');

			expect(result.allowed).toBe(true);
		});
	});
});
