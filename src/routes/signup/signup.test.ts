import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Supabaseクライアントのモック
const mockSupabaseClient = {
	auth: {
		signUp: vi.fn()
	}
};

// signupアクションをインポート（実際のパスに合わせて調整）
import { actions } from './+page.server';

describe('signup action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const createMockRequest = (body: any) => {
		return {
			formData: vi.fn().mockResolvedValue({
				get: (key: string) => body[key]
			})
		} as unknown as Request;
	};

	describe('既存ユーザーの検出', () => {
		it('identitiesが空配列の場合、既存ユーザーとして409を返す', async () => {
			const request = createMockRequest({
				fullName: 'Test User',
				email: 'existing@example.com',
				password: 'password123'
			});

			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			// Supabaseが既存ユーザーに対して返すレスポンスをシミュレート
			mockSupabaseClient.auth.signUp.mockResolvedValue({
				data: {
					user: {
						id: 'user-123',
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
					fullName: 'Test User',
					email: 'existing@example.com',
					error: 'このメールアドレスは既に登録されています。ログインしてください。'
				}
			});
		});

			it('identitiesが存在する場合、正常にサインアップ処理を継続', async () => {
			const request = createMockRequest({
				fullName: 'New User',
				email: 'new@example.com',
				password: 'password123'
			});

			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			// 新規ユーザーのレスポンス
			mockSupabaseClient.auth.signUp.mockResolvedValue({
				data: {
					user: {
						id: 'user-456',
						email: 'new@example.com',
						identities: [{ provider: 'email' }] // identitiesが存在
					},
					session: null
				},
				error: null
			});

			try {
				await actions.signup(event);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				// redirect(303, '/signup/success') が投げられることを期待
				expect(err.status).toBe(303);
				expect(err.location).toBe('/signup/success');
			}
		});

			it('authErrorがある場合は従来通りエラーハンドリング', async () => {
			const request = createMockRequest({
				fullName: 'Test User',
				email: 'error@example.com',
				password: 'password123'
			});

			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			mockSupabaseClient.auth.signUp.mockResolvedValue({
				data: { user: null, session: null },
				error: {
					code: 'user_already_exists',
					message: 'User already registered',
					status: 400
				}
			});

				const result = await actions.signup(event);

				expect(result).toMatchObject({
					status: 409,
					data: {
						error: 'このメールアドレスは既に使用されています。'
					}
				});
			});

			it('sessionが返る場合（設定エラー）は500エラーを返す', async () => {
				const request = createMockRequest({
					fullName: 'Auto User',
					email: 'auto@example.com',
					password: 'password123'
				});

				const event = {
					request,
					locals: { supabase: mockSupabaseClient }
				} as unknown as RequestEvent;

				mockSupabaseClient.auth.signUp.mockResolvedValue({
					data: {
						user: {
							id: 'user-auto-1',
							email: 'auto@example.com',
							identities: [{ provider: 'email' }]
						},
						session: { access_token: 'token' }
					},
					error: null
				});

				const result = await actions.signup(event);

				expect(result).toMatchObject({
					status: 500,
					data: {
						error: 'システム設定エラー: メール確認が必要です。管理者に連絡してください。'
					}
				});
			});
	});

	describe('バリデーション', () => {
		it('氏名が空の場合は400を返す', async () => {
			const request = createMockRequest({
				fullName: '',
				email: 'test@example.com',
				password: 'password123'
			});

			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			const result = await actions.signup(event);

			expect(result).toMatchObject({
				status: 400,
				data: {
					error: '氏名を入力してください。'
				}
			});
		});

		it('メールアドレスが空の場合は400を返す', async () => {
			const request = createMockRequest({
				fullName: 'Test User',
				email: '',
				password: 'password123'
			});

			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			const result = await actions.signup(event);

			expect(result).toMatchObject({
				status: 400,
				data: {
					error: 'メールアドレスを入力してください。'
				}
			});
		});

		it('パスワードが6文字未満の場合は400を返す', async () => {
			const request = createMockRequest({
				fullName: 'Test User',
				email: 'test@example.com',
				password: '12345' // 5文字
			});

			const event = {
				request,
				locals: { supabase: mockSupabaseClient }
			} as unknown as RequestEvent;

			const result = await actions.signup(event);

			expect(result).toMatchObject({
				status: 400,
				data: {
					error: 'パスワードは6文字以上で入力してください。'
				}
			});
		});
	});
});
