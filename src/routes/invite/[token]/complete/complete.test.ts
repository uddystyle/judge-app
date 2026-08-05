import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redirect } from '@sveltejs/kit';

// Supabase Adminクライアントのモック
const mockSupabaseAdmin = {
	from: vi.fn(),
	auth: {
		admin: {
			createUser: vi.fn()
		}
	}
};

// Supabaseクライアントのモック
const mockSupabase = {
	auth: {
		getUser: vi.fn()
	}
};

// モジュールのモック
vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => mockSupabaseAdmin)
}));

// メンバー上限チェックのモック（デフォルトは許可）
vi.mock('$lib/server/organizationLimits', () => ({
	checkCanAddMember: vi.fn(() => Promise.resolve({ allowed: true }))
}));

vi.mock('$lib/server/orgMembership', () => ({
	joinOrRestoreMember: vi.fn(() => Promise.resolve({ ok: true, restored: false }))
}));

// モックセットアップ後にインポート
const { load } = await import('./+page.server');
const { checkCanAddMember } = await import('$lib/server/organizationLimits');
const { joinOrRestoreMember } = await import('$lib/server/orgMembership');

describe('invite/[token]/complete - race condition handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(joinOrRestoreMember).mockResolvedValue({ ok: true, restored: false });
	});

	const createMockLocals = () => ({
		supabase: mockSupabase
	});

	const mockUser = {
		id: 'user-123',
		email: 'test@example.com',
		email_confirmed_at: '2024-01-01T00:00:00Z',
		user_metadata: {
			full_name: 'Test User'
		}
	};

	const mockInvitation = {
		id: 'invite-123',
		token: 'test-token',
		organization_id: 'org-123',
		email: 'test@example.com',
		expires_at: new Date(Date.now() + 86400000).toISOString(), // 24時間後
		max_uses: null,
		used_count: 0,
		role: 'member',
		organizations: {
			id: 'org-123',
			name: 'Test Organization'
		}
	};

	it('joinOrRestoreMember が既存メンバーを返した場合は組織ページへリダイレクトする', async () => {
		const params = { token: 'test-token' };
		const locals = createMockLocals();

		// getUser: 認証済みユーザーを返す
		mockSupabase.auth.getUser.mockResolvedValue({
			data: { user: mockUser },
			error: null
		});

		// 招待情報の取得
		const invitationQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			// 使用権の確定（claimInvitationUse）は update().eq().eq().select() を await する。
			// 1行返る＝使用権を得られた、を表す。
			update: vi.fn().mockReturnThis(),
			then: (resolve: any) =>
				Promise.resolve({ data: [{ id: 'invite-123' }], error: null }).then(resolve),
			single: vi.fn().mockResolvedValue({
				data: mockInvitation,
				error: null
			})
		};

		// 既存メンバーシップチェック（存在しない）
		const membershipQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			is: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({
				data: null,
				error: { code: 'PGRST116' } // Not found
			})
		};

		// 既存プロフィールチェック（存在する）
		const profileQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({
				data: { id: mockUser.id },
				error: null
			})
		};

		vi.mocked(joinOrRestoreMember).mockResolvedValueOnce({ ok: false, alreadyMember: true });

		// from() のモック設定
		mockSupabaseAdmin.from.mockImplementation((table: string) => {
			if (table === 'invitations') return invitationQuery;
			if (table === 'organization_members' && membershipQuery.select.mock.calls.length === 0) {
				return membershipQuery;
			}
			if (table === 'profiles') return profileQuery;
			return {};
		});

		try {
			await load({ params, locals } as any);
			expect.fail('Expected redirect to be thrown');
		} catch (err: any) {
			expect(err.status).toBe(303);
			expect(err.location).toBe('/organization/org-123');
		}
	});

	it('メンバー上限に達している場合は403を返し、メンバー追加を行わない', async () => {
		const params = { token: 'test-token' };
		const locals = createMockLocals();

		mockSupabase.auth.getUser.mockResolvedValue({
			data: { user: mockUser },
			error: null
		});

		// 上限チェックを「不可」に設定（受諾時の上限強制を検証）
		vi.mocked(checkCanAddMember).mockResolvedValueOnce({
			allowed: false,
			reason: '組織メンバー数の上限（1人）に達しています。'
		});

		const invitationQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			// 使用権の確定（claimInvitationUse）は update().eq().eq().select() を await する。
			// 1行返る＝使用権を得られた、を表す。
			update: vi.fn().mockReturnThis(),
			then: (resolve: any) =>
				Promise.resolve({ data: [{ id: 'invite-123' }], error: null }).then(resolve),
			single: vi.fn().mockResolvedValue({ data: mockInvitation, error: null })
		};
		const membershipQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			is: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
		};
		const profileQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({ data: { id: mockUser.id }, error: null })
		};
		mockSupabaseAdmin.from.mockImplementation((table: string) => {
			if (table === 'invitations') return invitationQuery;
			if (table === 'organization_members' && membershipQuery.select.mock.calls.length === 0) {
				return membershipQuery;
			}
			if (table === 'profiles') return profileQuery;
			return {};
		});

		try {
			await load({ params, locals } as any);
			expect.fail('Expected error(403) to be thrown');
		} catch (err: any) {
			expect(err.status).toBe(403);
		}

		// メンバー上限超過時は参加・復帰処理を行わない
		expect(joinOrRestoreMember).not.toHaveBeenCalled();
	});

	it('プロフィール作成時の一意制約違反（23505）を成功として扱う', async () => {
		const params = { token: 'test-token' };
		const locals = createMockLocals();

		mockSupabase.auth.getUser.mockResolvedValue({
			data: { user: mockUser },
			error: null
		});

		const calls: string[] = [];

		mockSupabaseAdmin.from.mockImplementation((table: string) => {
			calls.push(table);

			if (table === 'invitations' && calls.filter((c) => c === 'invitations').length === 1) {
				// 招待情報の取得
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: mockInvitation,
						error: null
					})
				};
			}

			if (
				table === 'organization_members' &&
				calls.filter((c) => c === 'organization_members').length === 1
			) {
				// 既存メンバーシップチェック（存在しない）
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					is: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: null,
						error: { code: 'PGRST116' }
					})
				};
			}

			if (table === 'profiles' && calls.filter((c) => c === 'profiles').length === 1) {
				// 既存プロフィールチェック（存在しない）
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: null,
						error: { code: 'PGRST116' }
					})
				};
			}

			if (table === 'profiles' && calls.filter((c) => c === 'profiles').length === 2) {
				// プロフィール作成（一意制約違反）
				return {
					insert: vi.fn().mockResolvedValue({
						data: null,
						error: {
							code: '23505',
							message: 'duplicate key value violates unique constraint'
						}
					})
				};
			}

			if (table === 'invitations' && calls.filter((c) => c === 'invitations').length === 2) {
				// 使用権の確定（claimInvitationUse）: update().eq().eq().select() を await する
				return {
					update: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					select: vi.fn().mockResolvedValue({
						data: [{ id: 'invite-123' }],
						error: null
					})
				};
			}

			if (table === 'invitation_uses') {
				// 招待使用履歴記録
				return {
					insert: vi.fn().mockResolvedValue({
						data: [{ id: 'usage-123' }],
						error: null
					})
				};
			}

			return {};
		});

		try {
			await load({ params, locals } as any);
			expect.fail('Expected redirect to be thrown');
		} catch (err: any) {
			// プロフィール作成の一意制約違反は無視し、メンバー追加が成功したら組織ページにリダイレクト
			expect(err.status).toBe(303);
			expect(err.location).toBe('/organization/org-123');
		}
	});

	it('招待使用履歴記録時の一意制約違反（23505）を成功として扱う', async () => {
		const params = { token: 'test-token' };
		const locals = createMockLocals();

		mockSupabase.auth.getUser.mockResolvedValue({
			data: { user: mockUser },
			error: null
		});

		const calls: string[] = [];

		mockSupabaseAdmin.from.mockImplementation((table: string) => {
			calls.push(table);

			if (table === 'invitations' && calls.filter((c) => c === 'invitations').length === 1) {
				// 招待情報の取得
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: mockInvitation,
						error: null
					})
				};
			}

			if (
				table === 'organization_members' &&
				calls.filter((c) => c === 'organization_members').length === 1
			) {
				// 既存メンバーシップチェック（存在しない）
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					is: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: null,
						error: { code: 'PGRST116' }
					})
				};
			}

			if (table === 'profiles') {
				// 既存プロフィールチェック（存在する）
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: { id: mockUser.id },
						error: null
					})
				};
			}

			if (table === 'invitations' && calls.filter((c) => c === 'invitations').length === 2) {
				// 使用権の確定（claimInvitationUse）: update().eq().eq().select() を await する
				return {
					update: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					select: vi.fn().mockResolvedValue({
						data: [{ id: 'invite-123' }],
						error: null
					})
				};
			}

			if (table === 'invitation_uses') {
				// 招待使用履歴記録（一意制約違反）
				return {
					insert: vi.fn().mockResolvedValue({
						data: null,
						error: {
							code: '23505',
							message: 'duplicate key value violates unique constraint'
						}
					})
				};
			}

			return {};
		});

		try {
			await load({ params, locals } as any);
			expect.fail('Expected redirect to be thrown');
		} catch (err: any) {
			// 招待使用履歴の一意制約違反は無視し、メンバー追加が成功したら組織ページにリダイレクト
			expect(err.status).toBe(303);
			expect(err.location).toBe('/organization/org-123');
		}
	});

	it('メンバー追加時の予期しないエラー（非23505）は500エラーを返す', async () => {
		const params = { token: 'test-token' };
		const locals = createMockLocals();

		mockSupabase.auth.getUser.mockResolvedValue({
			data: { user: mockUser },
			error: null
		});

		// 招待情報の取得
		const invitationQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			// 使用権の確定（claimInvitationUse）は update().eq().eq().select() を await する。
			// 1行返る＝使用権を得られた、を表す。
			update: vi.fn().mockReturnThis(),
			then: (resolve: any) =>
				Promise.resolve({ data: [{ id: 'invite-123' }], error: null }).then(resolve),
			single: vi.fn().mockResolvedValue({
				data: mockInvitation,
				error: null
			})
		};

		// 既存メンバーシップチェック（存在しない）
		const membershipQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			is: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({
				data: null,
				error: { code: 'PGRST116' }
			})
		};

		// 既存プロフィールチェック（存在する）
		const profileQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({
				data: { id: mockUser.id },
				error: null
			})
		};

		vi.mocked(joinOrRestoreMember).mockResolvedValueOnce({
			ok: false,
			error: 'permission denied for table organization_members'
		});

		mockSupabaseAdmin.from.mockImplementation((table: string) => {
			if (table === 'invitations') return invitationQuery;
			if (table === 'organization_members' && membershipQuery.select.mock.calls.length === 0) {
				return membershipQuery;
			}
			if (table === 'profiles') return profileQuery;
			return {};
		});

		try {
			await load({ params, locals } as any);
			expect.fail('Expected error to be thrown');
		} catch (err: any) {
			// 予期しないエラーの場合は500エラー
			expect(err.status).toBe(500);
			expect(err.body.message).toBe('組織への追加に失敗しました');
		}
	});
});
