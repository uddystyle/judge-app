/**
 * join action - JWT ロールバック検証テスト
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

// レート制限モジュールのモック
vi.mock('$lib/server/rateLimit', () => ({
	rateLimiters: null,
	checkRateLimit: vi.fn(() => Promise.resolve({ success: true }))
}));

// 組織制限チェックのモック
vi.mock('$lib/server/organizationLimits', () => ({
	checkCanAddJudgeToSession: vi.fn(() => Promise.resolve({ allowed: true }))
}));

describe('join action - JWT ロールバック検証', () => {
	let mockSupabase: any;
	let mockRequest: any;
	let insertCallCount: number;
	let deleteCallCount: number;
	let signInAnonymouslyCallCount: number;

	beforeEach(() => {
		insertCallCount = 0;
		deleteCallCount = 0;
		signInAnonymouslyCallCount = 0;

		// FormData モック
		const formData = new Map<string, string>();
		mockRequest = {
			formData: vi.fn(() => {
				return Promise.resolve({
					get: (key: string) => formData.get(key),
					set: (key: string, value: string) => formData.set(key, value)
				});
			}),
			headers: new Map([['x-forwarded-for', '127.0.0.1']])
		};

		// デフォルトのフォームデータ
		formData.set('joinCode', 'ABCD1234');
		formData.set('guestName', 'テストゲスト');
		formData.set('isGuest', 'true');

		// Supabase モック
		mockSupabase = {
			auth: {
				getUser: vi.fn(() =>
					Promise.resolve({
						data: { user: null },
						error: null
					})
				),
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
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-123',
											is_accepting_participants: true,
											organization_id: 'org-123',
											failed_join_attempts: 0,
											is_locked: false,
											join_code: 'ABCD1234'
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
							// guest_identifierを記録
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
				error: { message: 'JWT issuance failed' }
			});

			// action 実行
			const result = await actions.join({
				request: mockRequest,
				locals: { supabase: mockSupabase }
			} as any);

			// 検証
			expect(insertCallCount).toBe(1); // INSERT実行
			expect(deleteCallCount).toBe(1); // DELETE実行（ロールバック）
			expect(result).toEqual({
				status: 500,
				joinCode: 'ABCD1234',
				guestName: 'テストゲスト',
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
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-123',
											is_accepting_participants: true,
											organization_id: 'org-123',
											failed_join_attempts: 0,
											is_locked: false,
											join_code: 'ABCD1234'
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
						access_token: 'valid_token',
						user: { id: 'anon-user-123' }
					}
				},
				error: null
			});

			// action 実行（redirectが投げられるはず）
			await expect(
				actions.join({
					request: mockRequest,
					locals: { supabase: mockSupabase }
				} as any)
			).rejects.toThrow('Redirecting to /session/session-123');

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
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-123',
											is_accepting_participants: true,
											organization_id: 'org-123',
											failed_join_attempts: 0,
											is_locked: false,
											join_code: 'ABCD1234'
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
									error: { message: 'Rollback failed', code: '23000' }
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
				locals: { supabase: mockSupabase }
			} as any);

			// 検証: ロールバック失敗でも、ユーザーには認証失敗として通知
			expect(insertCallCount).toBe(1);
			expect(deleteCallCount).toBe(1); // ロールバック試行
			expect(result).toEqual({
				status: 500,
				joinCode: 'ABCD1234',
				guestName: 'テストゲスト',
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
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-456',
											is_accepting_participants: true,
											organization_id: 'org-456',
											failed_join_attempts: 0,
											is_locked: false,
											join_code: 'ABCD1234'
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
					locals: { supabase: mockSupabase }
				} as any);
			} catch (e) {
				// redirect を無視
			}

			// 検証: user_metadata に正しい値が渡されている
			expect(capturedOptions).toHaveLength(1);
			expect(capturedOptions[0]).toHaveProperty('options');
			expect(capturedOptions[0].options).toHaveProperty('data');

			const metadata = capturedOptions[0].options.data;
			expect(metadata).toEqual({
				session_id: 'session-456',
				guest_identifier: expect.any(String), // UUID
				guest_name: 'テストゲスト',
				is_guest: true
			});

			// guest_identifier が UUID 形式であることを確認
			expect(metadata.guest_identifier).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
			);
		});

		it('guest_identifier はリクエストごとに異なる UUID が生成される', async () => {
			const capturedIdentifiers: string[] = [];

			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-123',
											is_accepting_participants: true,
											organization_id: 'org-123',
											failed_join_attempts: 0,
											is_locked: false,
											join_code: 'ABCD1234'
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
							if (data.guest_identifier) {
								capturedIdentifiers.push(data.guest_identifier);
							}
							return Promise.resolve({ error: null });
						}),
						delete: vi.fn(() => ({
							eq: vi.fn(() => Promise.resolve({ error: null }))
						}))
					};
				}
				return {};
			});

			mockSupabase.auth.signInAnonymously.mockResolvedValue({
				data: {
					session: {
						access_token: 'valid_token',
						user: { id: 'anon-user' }
					}
				},
				error: null
			});

			// 1回目のリクエスト
			try {
				await actions.join({
					request: mockRequest,
					locals: { supabase: mockSupabase }
				} as any);
			} catch (e) {
				// redirect を無視
			}

			// 2回目のリクエスト（新しいモック）
			const mockRequest2 = {
				formData: vi.fn(() => {
					const formData = new Map<string, string>();
					formData.set('joinCode', 'ABCD1234');
					formData.set('guestName', 'テストゲスト2');
					formData.set('isGuest', 'true');
					return Promise.resolve({
						get: (key: string) => formData.get(key)
					});
				}),
				headers: new Map([['x-forwarded-for', '127.0.0.1']])
			};

			try {
				await actions.join({
					request: mockRequest2,
					locals: { supabase: mockSupabase }
				} as any);
			} catch (e) {
				// redirect を無視
			}

			// 検証: 2つの異なる UUID が生成された
			expect(capturedIdentifiers).toHaveLength(2);
			expect(capturedIdentifiers[0]).not.toBe(capturedIdentifiers[1]);
			expect(capturedIdentifiers[0]).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
			);
			expect(capturedIdentifiers[1]).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
			);
		});

		it('user_metadata の各フィールドが正しい型である', async () => {
			const capturedOptions: any[] = [];

			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-999',
											is_accepting_participants: true,
											organization_id: 'org-999',
											failed_join_attempts: 0,
											is_locked: false,
											join_code: 'ABCD1234'
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
					locals: { supabase: mockSupabase }
				} as any);
			} catch (e) {
				// redirect を無視
			}

			const metadata = capturedOptions[0].options.data;

			// 型検証
			expect(typeof metadata.session_id).toBe('string');
			expect(typeof metadata.guest_identifier).toBe('string');
			expect(typeof metadata.guest_name).toBe('string');
			expect(typeof metadata.is_guest).toBe('boolean');

			// 値の妥当性
			expect(metadata.session_id.length).toBeGreaterThan(0);
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
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-789',
											is_accepting_participants: true,
											organization_id: 'org-789',
											failed_join_attempts: 0,
											is_locked: false,
											join_code: 'ABCD1234'
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
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-555',
											is_accepting_participants: true,
											organization_id: 'org-555',
											failed_join_attempts: 0,
											is_locked: false,
											join_code: 'ABCD1234'
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
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-111',
											is_accepting_participants: true,
											organization_id: 'org-111',
											failed_join_attempts: 0,
											is_locked: false,
											join_code: 'ABCD1234'
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
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-123',
											is_accepting_participants: true,
											organization_id: 'org-123',
											failed_join_attempts: 0,
											is_locked: false,
											join_code: 'ABCD1234'
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
								error: { message: 'Insert failed', code: '23000' }
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
				locals: { supabase: mockSupabase }
			} as any);

			// 検証
			expect(insertCallCount).toBe(1);
			expect(mockSupabase.auth.signInAnonymously).not.toHaveBeenCalled(); // JWT発行未実行
			expect(result).toEqual({
				status: 500,
				joinCode: 'ABCD1234',
				guestName: 'テストゲスト',
				error: expect.stringContaining('検定への参加に失敗しました')
			});
		});

		it('セッションが見つからない場合は404エラー', async () => {
			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: null,
										error: null
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
				locals: { supabase: mockSupabase }
			} as any);

			// 検証
			expect(mockSupabase.auth.signInAnonymously).not.toHaveBeenCalled();
			expect(result).toEqual({
				status: 404,
				joinCode: 'ABCD1234',
				error: '無効な参加コードです。'
			});
		});

		it('セッションがロックされている場合は423エラー', async () => {
			mockSupabase.from = vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 'session-123',
											is_accepting_participants: true,
											organization_id: 'org-123',
											failed_join_attempts: 0,
											is_locked: true, // ロック状態
											join_code: 'ABCD1234'
										},
										error: null
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
				locals: { supabase: mockSupabase }
			} as any);

			// 検証
			expect(mockSupabase.auth.signInAnonymously).not.toHaveBeenCalled();
			expect(result).toEqual({
				status: 423,
				joinCode: 'ABCD1234',
				guestName: 'テストゲスト',
				error: '不正なアクセスが検出されたため、このセッションはロックされました。'
			});
		});
	});
});
