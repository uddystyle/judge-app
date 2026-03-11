/**
 * invite/[token] action - JWT ロールバック検証テスト
 *
 * 実際の action 実装に対する回帰検知を入れる
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { actions } from './+page.server';
import { redirect } from '@sveltejs/kit';

// @sveltejs/kit のモック
vi.mock('@sveltejs/kit', () => ({
	fail: (status: number, data: any) => ({ status, ...data }),
	redirect: (status: number, location: string) => {
		const error = new Error(`Redirecting to ${location}`);
		(error as any).status = status;
		(error as any).location = location;
		throw error;
	}
}));

// 組織制限チェックのモック
vi.mock('$lib/server/organizationLimits', () => ({
	checkCanAddJudgeToSession: vi.fn(() => Promise.resolve({ allowed: true }))
}));

describe('invite/[token] action - JWT ロールバック検証', () => {
	let mockSupabase: any;
	let mockRequest: any;
	let mockParams: any;
	let insertCallCount: number;
	let deleteCallCount: number;

	beforeEach(() => {
		insertCallCount = 0;
		deleteCallCount = 0;

		// FormData モック
		const formData = new Map<string, string>();
		mockRequest = {
			formData: vi.fn(() => {
				return Promise.resolve({
					get: (key: string) => formData.get(key),
					set: (key: string, value: string) => formData.set(key, value)
				});
			})
		};

		// デフォルトのフォームデータ
		formData.set('guestName', 'テストゲスト（招待）');

		// Params モック
		mockParams = {
			token: 'valid-invite-token-123'
		};

		// Supabase モック
		mockSupabase = {
			auth: {
				signInAnonymously: vi.fn()
			},
			from: vi.fn()
		};
	});

	describe('JWT発行失敗時のロールバック', () => {
		it('signInAnonymously() 失敗時に session_participants.delete().eq("guest_identifier", ...) が呼ばれる', async () => {
			const guestIdentifierCapture: string[] = [];

			// session_participants INSERT/DELETE モック
			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								single: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-invite-123',
											organization_id: 'org-invite-123'
										},
										error: null
									})
								)
							}))
						}))
					};
				} else if (table === 'session_participants') {
					return {
						insert: vi.fn((data: any) => {
							insertCallCount++;
							if (data.guest_identifier) {
								guestIdentifierCapture.push(data.guest_identifier);
							}
							return Promise.resolve({ error: null });
						}),
						delete: vi.fn(() => ({
							eq: vi.fn((field: string, value: any) => {
								deleteCallCount++;
								// 正しい guest_identifier が渡されたか検証
								expect(field).toBe('guest_identifier');
								expect(guestIdentifierCapture).toContain(value);
								return Promise.resolve({ error: null });
							})
						}))
					};
				}
				return {};
			});

			// JWT発行失敗をシミュレート
			mockSupabase.auth.signInAnonymously.mockResolvedValue({
				data: { session: null },
				error: { message: 'JWT issuance failed via invite link' }
			});

			// action 実行
			const result = await actions.join({
				request: mockRequest,
				params: mockParams,
				locals: { supabase: mockSupabase }
			} as any);

			// 検証
			expect(insertCallCount).toBe(1); // INSERT実行
			expect(deleteCallCount).toBe(1); // DELETE実行（ロールバック）
			expect(result).toEqual({
				status: 500,
				error: '認証に失敗しました。再度お試しください。'
			});
		});

		it('JWT発行成功時は delete が呼ばれず redirect(303, ...) になる', async () => {
			// session_participants INSERT/DELETE モック
			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								single: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-invite-456',
											organization_id: 'org-invite-456'
										},
										error: null
									})
								)
							}))
						}))
					};
				} else if (table === 'session_participants') {
					return {
						insert: vi.fn(() => {
							insertCallCount++;
							return Promise.resolve({ error: null });
						}),
						delete: vi.fn(() => ({
							eq: vi.fn(() => {
								deleteCallCount++;
								return Promise.resolve({ error: null });
							})
						}))
					};
				}
				return {};
			});

			// JWT発行成功をシミュレート
			mockSupabase.auth.signInAnonymously.mockResolvedValue({
				data: {
					session: {
						access_token: 'valid_invite_token',
						user: { id: 'anon-user-invite-123' }
					}
				},
				error: null
			});

			// action 実行（redirectが投げられるはず）
			await expect(
				actions.join({
					request: mockRequest,
					params: mockParams,
					locals: { supabase: mockSupabase }
				} as any)
			).rejects.toThrow('Redirecting to /session/session-invite-456');

			// 検証
			expect(insertCallCount).toBe(1); // INSERT実行
			expect(deleteCallCount).toBe(0); // DELETE未実行（ロールバックしない）
		});

		it('rollback失敗時も利用者向けは認証失敗レスポンスになる', async () => {
			// session_participants INSERT/DELETE モック
			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								single: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-invite-789',
											organization_id: 'org-invite-789'
										},
										error: null
									})
								)
							}))
						}))
					};
				} else if (table === 'session_participants') {
					return {
						insert: vi.fn(() => {
							insertCallCount++;
							return Promise.resolve({ error: null });
						}),
						delete: vi.fn(() => ({
							eq: vi.fn(() => {
								deleteCallCount++;
								// ロールバック失敗をシミュレート
								return Promise.resolve({
									error: { message: 'Rollback failed in invite', code: '23000' }
								});
							})
						}))
					};
				}
				return {};
			});

			// JWT発行失敗をシミュレート
			mockSupabase.auth.signInAnonymously.mockResolvedValue({
				data: { session: null },
				error: { message: 'JWT issuance failed' }
			});

			// action 実行
			const result = await actions.join({
				request: mockRequest,
				params: mockParams,
				locals: { supabase: mockSupabase }
			} as any);

			// 検証: ロールバック失敗でも、ユーザーには認証失敗として通知
			expect(insertCallCount).toBe(1);
			expect(deleteCallCount).toBe(1); // ロールバック試行
			expect(result).toEqual({
				status: 500,
				error: '認証に失敗しました。再度お試しください。'
			});
		});
	});

	describe('JWT発行の呼び出し検証', () => {
		it('signInAnonymously() に正しい user_metadata が渡される', async () => {
			const capturedOptions: any[] = [];

			// session_participants モック
			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								single: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 999,
											organization_id: 'org-999'
										},
										error: null
									})
								)
							}))
						}))
					};
				} else if (table === 'session_participants') {
					return {
						insert: vi.fn(() => Promise.resolve({ error: null })),
						delete: vi.fn(() => ({
							eq: vi.fn(() => Promise.resolve({ error: null }))
						}))
					};
				}
				return {};
			});

			// JWT発行のオプションをキャプチャ
			mockSupabase.auth.signInAnonymously.mockImplementation((opts: any) => {
				capturedOptions.push(opts);
				return Promise.resolve({
					data: {
						session: {
							access_token: 'valid_token',
							user: { id: 'anon-user' }
						}
					},
					error: null
				});
			});

			// action 実行
			try {
				await actions.join({
					request: mockRequest,
					params: mockParams,
					locals: { supabase: mockSupabase }
				} as any);
			} catch (e) {
				// redirect を無視
			}

			// 検証: user_metadata に必須フィールドがすべて含まれている
			expect(capturedOptions).toHaveLength(1);
			expect(capturedOptions[0]).toHaveProperty('options');
			expect(capturedOptions[0].options).toHaveProperty('data');

			const metadata = capturedOptions[0].options.data;

			// ✅ RLS前提の必須フィールドをすべて検証
			expect(metadata).toHaveProperty('session_id');
			expect(metadata.session_id).toBe(999);

			expect(metadata).toHaveProperty('guest_identifier');
			expect(metadata.guest_identifier).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
			);

			expect(metadata).toHaveProperty('guest_name');
			expect(metadata.guest_name).toBe('テストゲスト（招待）');

			expect(metadata).toHaveProperty('is_guest');
			expect(metadata.is_guest).toBe(true);
		});

		it('user_metadata の各フィールドが正しい型である', async () => {
			const capturedOptions: any[] = [];

			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								single: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 888,
											organization_id: 'org-888'
										},
										error: null
									})
								)
							}))
						}))
					};
				} else if (table === 'session_participants') {
					return {
						insert: vi.fn(() => Promise.resolve({ error: null })),
						delete: vi.fn(() => ({
							eq: vi.fn(() => Promise.resolve({ error: null }))
						}))
					};
				}
				return {};
			});

			mockSupabase.auth.signInAnonymously.mockImplementation((opts: any) => {
				capturedOptions.push(opts);
				return Promise.resolve({
					data: {
						session: {
							access_token: 'valid_token',
							user: { id: 'anon-user' }
						}
					},
					error: null
				});
			});

			try {
				await actions.join({
					request: mockRequest,
					params: mockParams,
					locals: { supabase: mockSupabase }
				} as any);
			} catch (e) {
				// redirect を無視
			}

			const metadata = capturedOptions[0].options.data;

			// 型検証
			expect(typeof metadata.session_id).toBe('number');
			expect(typeof metadata.guest_identifier).toBe('string');
			expect(typeof metadata.guest_name).toBe('string');
			expect(typeof metadata.is_guest).toBe('boolean');

			// 値の妥当性
			expect(metadata.session_id).toBeGreaterThan(0);
			expect(metadata.guest_identifier.length).toBeGreaterThan(0);
			expect(metadata.guest_name.length).toBeGreaterThan(0);
			expect(metadata.is_guest).toBe(true);
		});

		it('guest_identifier が UUID v4 形式である', async () => {
			const capturedOptions: any[] = [];

			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								single: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 777,
											organization_id: 'org-777'
										},
										error: null
									})
								)
							}))
						}))
					};
				} else if (table === 'session_participants') {
					return {
						insert: vi.fn(() => Promise.resolve({ error: null })),
						delete: vi.fn(() => ({
							eq: vi.fn(() => Promise.resolve({ error: null }))
						}))
					};
				}
				return {};
			});

			mockSupabase.auth.signInAnonymously.mockImplementation((opts: any) => {
				capturedOptions.push(opts);
				return Promise.resolve({
					data: {
						session: {
							access_token: 'valid_token',
							user: { id: 'anon-user' }
						}
					},
					error: null
				});
			});

			try {
				await actions.join({
					request: mockRequest,
					params: mockParams,
					locals: { supabase: mockSupabase }
				} as any);
			} catch (e) {
				// redirect を無視
			}

			const metadata = capturedOptions[0].options.data;

			// UUID v4 形式（8-4-4-4-12）
			const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
			expect(metadata.guest_identifier).toMatch(uuidV4Regex);
		});

		it('session_id が null または undefined でないことを検証', async () => {
			const capturedOptions: any[] = [];

			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								single: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 666,
											organization_id: 'org-666'
										},
										error: null
									})
								)
							}))
						}))
					};
				} else if (table === 'session_participants') {
					return {
						insert: vi.fn(() => Promise.resolve({ error: null })),
						delete: vi.fn(() => ({
							eq: vi.fn(() => Promise.resolve({ error: null }))
						}))
					};
				}
				return {};
			});

			mockSupabase.auth.signInAnonymously.mockImplementation((opts: any) => {
				capturedOptions.push(opts);
				return Promise.resolve({
					data: {
						session: {
							access_token: 'valid_token',
							user: { id: 'anon-user' }
						}
					},
					error: null
				});
			});

			try {
				await actions.join({
					request: mockRequest,
					params: mockParams,
					locals: { supabase: mockSupabase }
				} as any);
			} catch (e) {
				// redirect を無視
			}

			const metadata = capturedOptions[0].options.data;

			// RLSポリシーが依存するため、null/undefined は許容できない
			expect(metadata.session_id).not.toBeNull();
			expect(metadata.session_id).not.toBeUndefined();
			expect(metadata.guest_identifier).not.toBeNull();
			expect(metadata.guest_identifier).not.toBeUndefined();
			expect(metadata.guest_name).not.toBeNull();
			expect(metadata.guest_name).not.toBeUndefined();
			expect(metadata.is_guest).not.toBeNull();
			expect(metadata.is_guest).not.toBeUndefined();
		});

		it('is_guest が厳密に true であることを検証（truthy ではなく）', async () => {
			const capturedOptions: any[] = [];

			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								single: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 555,
											organization_id: 'org-555'
										},
										error: null
									})
								)
							}))
						}))
					};
				} else if (table === 'session_participants') {
					return {
						insert: vi.fn(() => Promise.resolve({ error: null })),
						delete: vi.fn(() => ({
							eq: vi.fn(() => Promise.resolve({ error: null }))
						}))
					};
				}
				return {};
			});

			mockSupabase.auth.signInAnonymously.mockImplementation((opts: any) => {
				capturedOptions.push(opts);
				return Promise.resolve({
					data: {
						session: {
							access_token: 'valid_token',
							user: { id: 'anon-user' }
						}
					},
					error: null
				});
			});

			try {
				await actions.join({
					request: mockRequest,
					params: mockParams,
					locals: { supabase: mockSupabase }
				} as any);
			} catch (e) {
				// redirect を無視
			}

			const metadata = capturedOptions[0].options.data;

			// 厳密な比較（RLSポリシーが `is_guest = true` を使用）
			expect(metadata.is_guest).toBe(true);
			expect(metadata.is_guest).not.toBe(1); // truthy な値ではダメ
			expect(metadata.is_guest).not.toBe('true');
			expect(metadata.is_guest === true).toBe(true);
		});
	});

	describe('エッジケース', () => {
		it('INSERT失敗時は JWT発行を試みない', async () => {
			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								single: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 444,
											organization_id: 'org-444'
										},
										error: null
									})
								)
							}))
						}))
					};
				} else if (table === 'session_participants') {
					return {
						insert: vi.fn(() => {
							insertCallCount++;
							// INSERT失敗をシミュレート
							return Promise.resolve({
								error: { message: 'Insert failed in invite', code: '23000' }
							});
						})
					};
				}
				return {};
			});

			mockSupabase.auth.signInAnonymously.mockResolvedValue({
				data: { session: null },
				error: null
			});

			// action 実行
			const result = await actions.join({
				request: mockRequest,
				params: mockParams,
				locals: { supabase: mockSupabase }
			} as any);

			// 検証
			expect(insertCallCount).toBe(1);
			expect(mockSupabase.auth.signInAnonymously).not.toHaveBeenCalled(); // JWT発行未実行
			expect(result).toEqual({
				status: 500,
				error: 'セッションへの参加に失敗しました。'
			});
		});

		it('無効なトークンの場合は400エラー', async () => {
			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								single: vi.fn(() =>
									Promise.resolve({
										data: null,
										error: { message: 'Session not found', code: 'PGRST116' }
									})
								)
							}))
						}))
					};
				}
				return {};
			});

			// action 実行
			const result = await actions.join({
				request: mockRequest,
				params: mockParams,
				locals: { supabase: mockSupabase }
			} as any);

			// 検証
			expect(mockSupabase.auth.signInAnonymously).not.toHaveBeenCalled();
			expect(result).toEqual({
				status: 400,
				error: '招待リンクが無効です。'
			});
		});

		it('guestName未入力の場合は400エラー', async () => {
			// FormDataを空にする
			const emptyFormData = new Map<string, string>();
			mockRequest = {
				formData: vi.fn(() => {
					return Promise.resolve({
						get: (key: string) => emptyFormData.get(key)
					});
				})
			};

			// action 実行
			const result = await actions.join({
				request: mockRequest,
				params: mockParams,
				locals: { supabase: mockSupabase }
			} as any);

			// 検証
			expect(result).toEqual({
				status: 400,
				error: '名前を入力してください。'
			});
		});
	});
});
