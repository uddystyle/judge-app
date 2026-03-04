import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

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
		signUp: vi.fn(),
		signInWithPassword: vi.fn(),
		getUser: vi.fn()
	}
};

// モジュールのモック
vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => mockSupabaseAdmin)
}));

// モックセットアップ後にインポート
const { actions } = await import('./+page.server');

describe('invite/[token] - signup action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const createMockRequest = (body: any) => {
		return {
			formData: vi.fn().mockResolvedValue({
				get: (key: string) => body[key]?.toString()
			})
		} as unknown as Request;
	};

	describe('既存ユーザーの検出', () => {
		it('既存ユーザー（identitiesが空）の場合、409エラーを返す', async () => {
			const request = createMockRequest({
				email: 'existing@example.com',
				password: 'password123',
				fullName: 'Existing User'
			});

			const event = {
				request,
				params: { token: 'test-token' },
				locals: { supabase: mockSupabase }
			} as unknown as RequestEvent;

			const mockInvitation = {
				id: 'invite-123',
				email: null,
				organization_id: 'org-123',
				role: 'member',
				expires_at: new Date(Date.now() + 86400000).toISOString(),
				used_count: 0,
				organizations: {
					id: 'org-123',
					name: 'Test Organization'
				}
			};

			mockSupabaseAdmin.from.mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						single: vi.fn().mockResolvedValue({
							data: mockInvitation,
							error: null
						})
					})
				})
			});

			// 既存ユーザーの場合のレスポンス（identitiesが空配列）
			mockSupabase.auth.signUp.mockResolvedValue({
				data: {
					user: {
						id: 'user-existing',
						email: 'existing@example.com',
						identities: [] // 空配列 = 既存ユーザー
					},
					session: null
				},
				error: null
			});

			const result = await actions.signup(event);

			expect(result).toMatchObject({
				status: 409,
				data: {
					error: 'このメールアドレスは既に登録されています。ログインしてから招待リンクを使用してください。'
				}
			});
		});
	});

	describe('メールアドレス照合（セキュリティ）', () => {
		it('招待メールと入力メールが一致する場合、メール確認画面にリダイレクトされる', async () => {
			const request = createMockRequest({
				email: 'invited@example.com',
				password: 'password123',
				fullName: 'Test User'
			});

			const event = {
				request,
				params: { token: 'test-token' },
				locals: { supabase: mockSupabase }
			} as unknown as RequestEvent;

			// 招待情報（メール指定あり）
			const mockInvitation = {
				id: 'invite-123',
				email: 'invited@example.com', // 招待メールが指定されている
				organization_id: 'org-123',
				role: 'member',
				expires_at: new Date(Date.now() + 86400000).toISOString(),
				used_count: 0,
				organizations: {
					id: 'org-123',
					name: 'Test Organization'
				}
			};

			mockSupabaseAdmin.from.mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						single: vi.fn().mockResolvedValue({
							data: mockInvitation,
							error: null
						})
					})
				})
			});

			// 通常のsignUpを使用（メール確認必須）
			mockSupabase.auth.signUp.mockResolvedValue({
				data: {
					user: {
						id: 'user-123',
						email: 'invited@example.com',
						identities: [{ provider: 'email' }]
					},
					session: null // メール未確認のためセッションなし
				},
				error: null
			});

			try {
				await actions.signup(event);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				// メール確認画面にリダイレクト
				expect(err.status).toBe(303);
				expect(err.location).toBe('/invite/test-token/check-email');
			}

			// signUpが呼ばれたことを確認（email_confirm: falseがデフォルト）
			expect(mockSupabase.auth.signUp).toHaveBeenCalledWith({
				email: 'invited@example.com',
				password: 'password123',
				options: {
					data: {
						full_name: 'Test User',
						invitation_token: 'test-token'
					},
					emailRedirectTo: expect.stringContaining('/auth/callback?next=/invite/test-token/complete')
				}
			});
		});

		it('招待メールと入力メールが一致しない場合、403エラーを返す（セキュリティ）', async () => {
			const request = createMockRequest({
				email: 'attacker@example.com', // 異なるメール
				password: 'password123',
				fullName: 'Attacker'
			});

			const event = {
				request,
				params: { token: 'test-token' },
				locals: { supabase: mockSupabase }
			} as unknown as RequestEvent;

			// 招待情報（メール指定あり）
			const mockInvitation = {
				id: 'invite-123',
				email: 'invited@example.com', // 招待メールが指定されている
				organization_id: 'org-123',
				role: 'member',
				expires_at: new Date(Date.now() + 86400000).toISOString(),
				used_count: 0,
				organizations: {
					id: 'org-123',
					name: 'Test Organization'
				}
			};

			mockSupabaseAdmin.from.mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						single: vi.fn().mockResolvedValue({
							data: mockInvitation,
							error: null
						})
					})
				})
			});

			const result = await actions.signup(event);

			// 403エラーが返されることを確認
			expect(result).toMatchObject({
				status: 403,
				data: {
					error: 'この招待は別のメールアドレス宛です。招待されたメールアドレスを使用してください。'
				}
			});

			// signUpが呼ばれていないことを確認（重要！）
			expect(mockSupabase.auth.signUp).not.toHaveBeenCalled();
		});

		it('招待メールが指定されていない場合（null）、任意のメールでアカウント作成が可能', async () => {
			const request = createMockRequest({
				email: 'anyone@example.com',
				password: 'password123',
				fullName: 'Anyone'
			});

			const event = {
				request,
				params: { token: 'test-token' },
				locals: { supabase: mockSupabase }
			} as unknown as RequestEvent;

			// 招待情報（メール指定なし）
			const mockInvitation = {
				id: 'invite-123',
				email: null, // メール指定なし
				organization_id: 'org-123',
				role: 'member',
				expires_at: new Date(Date.now() + 86400000).toISOString(),
				used_count: 0,
				organizations: {
					id: 'org-123',
					name: 'Test Organization'
				}
			};

			mockSupabaseAdmin.from.mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						single: vi.fn().mockResolvedValue({
							data: mockInvitation,
							error: null
						})
					})
				})
			});

			mockSupabase.auth.signUp.mockResolvedValue({
				data: {
					user: {
						id: 'user-456',
						email: 'anyone@example.com',
						identities: [{ provider: 'email' }]
					},
					session: null
				},
				error: null
			});

			try {
				await actions.signup(event);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(err.status).toBe(303);
				expect(err.location).toBe('/invite/test-token/check-email');
			}

			// 任意のメールでsignUpが呼ばれることを確認
			expect(mockSupabase.auth.signUp).toHaveBeenCalledWith({
				email: 'anyone@example.com',
				password: 'password123',
				options: {
					data: {
						full_name: 'Anyone',
						invitation_token: 'test-token'
					},
					emailRedirectTo: expect.stringContaining('/auth/callback?next=/invite/test-token/complete')
				}
			});
		});
	});

	describe('バリデーション', () => {
		it('メールアドレスが空の場合、400エラーを返す', async () => {
			const request = createMockRequest({
				email: '',
				password: 'password123',
				fullName: 'Test User'
			});

			const event = {
				request,
				params: { token: 'test-token' },
				locals: { supabase: mockSupabase }
			} as unknown as RequestEvent;

			const result = await actions.signup(event);

			expect(result).toMatchObject({
				status: 400,
				data: {
					error: 'すべてのフィールドを入力してください'
				}
			});
		});

		it('パスワードが空の場合、400エラーを返す', async () => {
			const request = createMockRequest({
				email: 'test@example.com',
				password: '',
				fullName: 'Test User'
			});

			const event = {
				request,
				params: { token: 'test-token' },
				locals: { supabase: mockSupabase }
			} as unknown as RequestEvent;

			const result = await actions.signup(event);

			expect(result).toMatchObject({
				status: 400,
				data: {
					error: 'すべてのフィールドを入力してください'
				}
			});
		});

		it('氏名が空の場合、400エラーを返す', async () => {
			const request = createMockRequest({
				email: 'test@example.com',
				password: 'password123',
				fullName: ''
			});

			const event = {
				request,
				params: { token: 'test-token' },
				locals: { supabase: mockSupabase }
			} as unknown as RequestEvent;

			const result = await actions.signup(event);

			expect(result).toMatchObject({
				status: 400,
				data: {
					error: 'すべてのフィールドを入力してください'
				}
			});
		});
	});

	describe('招待の有効性チェック', () => {
		it('有効期限切れの招待の場合、400エラーを返す', async () => {
			const request = createMockRequest({
				email: 'test@example.com',
				password: 'password123',
				fullName: 'Test User'
			});

			const event = {
				request,
				params: { token: 'expired-token' },
				locals: { supabase: mockSupabase }
			} as unknown as RequestEvent;

			// 期限切れの招待
			const mockInvitation = {
				id: 'invite-123',
				email: null,
				organization_id: 'org-123',
				role: 'member',
				expires_at: new Date(Date.now() - 86400000).toISOString(), // 過去の日時
				used_count: 0
			};

			mockSupabaseAdmin.from.mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						single: vi.fn().mockResolvedValue({
							data: mockInvitation,
							error: null
						})
					})
				})
			});

			const result = await actions.signup(event);

			expect(result).toMatchObject({
				status: 400,
				data: {
					error: '無効な招待です'
				}
			});
		});
	});
});
