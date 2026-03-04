import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { redirect, error, isRedirect, isHttpError } from '@sveltejs/kit';

// SvelteKitのredirect/errorは実際の関数を使用
// モックは不要（実際の関数がthrowするオブジェクトをテストで検証）

describe('auth/callback', () => {
	let mockSupabase: any;
	let mockLocals: any;
	let mockUrl: URL;

	beforeEach(() => {
		vi.clearAllMocks();

		// Supabaseクライアントのモック
		mockSupabase = {
			auth: {
				getUser: vi.fn(),
				exchangeCodeForSession: vi.fn(),
				verifyOtp: vi.fn()
			}
		};

		mockLocals = {
			supabase: mockSupabase
		};

		// URLのモック（基本的なケース）
		mockUrl = new URL('http://localhost:5173/auth/callback');
	});

	describe('PKCEフロー (code parameter)', () => {
		it('正常な認証でredirectを投げる', async () => {
			mockUrl.searchParams.set('code', 'valid_code_123');
			mockUrl.searchParams.set('next', '/dashboard');

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: {
					user: { id: 'user-123', email: 'test@example.com' },
					session: { access_token: 'token' }
				},
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				// SvelteKitのredirectオブジェクトであることを確認
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/dashboard');
			}

			expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('valid_code_123');
		});

		it('無効なnextパラメータの場合デフォルトにredirect', async () => {
			mockUrl.searchParams.set('code', 'valid_code_123');
			mockUrl.searchParams.set('next', 'https://evil.com'); // オープンリダイレクト攻撃

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: {
					user: { id: 'user-123', email: 'test@example.com' },
					session: { access_token: 'token' }
				},
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/onboarding/create-organization');
			}
		});

		it('コード交換エラー時にloginにredirect', async () => {
			mockUrl.searchParams.set('code', 'invalid_code');

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: null,
				error: {
					message: 'Invalid code',
					code: 'invalid_grant'
				}
			});

			// getUser は呼ばれないはず（コードが無効なので）
			mockSupabase.auth.getUser.mockResolvedValue({
				data: { user: null },
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				// エラーメッセージが含まれているかチェック
				expect(err.location).toContain('/login?error=');
			}
		});

		it('コード使用済みだが認証済みの場合dashboardにredirect', async () => {
			mockUrl.searchParams.set('code', 'used_code');

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: null,
				error: {
					message: 'Code has already been used',
					code: 'invalid_grant'
				}
			});

			mockSupabase.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user-123', email: 'test@example.com' } },
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/dashboard');
			}
		});

		it('コード使用済みで未認証の場合、適切なエラーメッセージ付きでloginにredirect', async () => {
			mockUrl.searchParams.set('code', 'used_code');

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: null,
				error: {
					message: 'Code has already been used',
					code: 'invalid_grant'
				}
			});

			mockSupabase.auth.getUser.mockResolvedValue({
				data: { user: null },
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toContain('/login?error=');
				// URL-encoded error message should be decoded before assertion
				const decodedLocation = decodeURIComponent(err.location);
				expect(decodedLocation).toContain('認証リンクが既に使用済みか無効です');
				expect(decodedLocation).toContain('登録済みの場合はそのままログインしてください');
			}
		});

		it('OTP期限切れの場合、適切なエラーメッセージ付きでloginにredirect', async () => {
			mockUrl.searchParams.set('code', 'expired_code');

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: null,
				error: {
					message: 'Token has expired',
					code: 'otp_expired'
				}
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toContain('/login?error=');
				const decodedLocation = decodeURIComponent(err.location);
				expect(decodedLocation).toContain('認証リンクの有効期限が切れています');
			}
		});

		it('予期しないエラーコードの場合、汎用エラーメッセージでloginにredirect', async () => {
			mockUrl.searchParams.set('code', 'some_code');

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: null,
				error: {
					message: 'Some unexpected error',
					code: 'unknown_error'
				}
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toContain('/login?error=');
				const decodedLocation = decodeURIComponent(err.location);
				expect(decodedLocation).toContain('認証に失敗しました。再度お試しください');
			}
		});
	});

	describe('トークンハッシュフロー (token_hash parameter)', () => {
		it('正常な認証でredirectを投げる', async () => {
			mockUrl.searchParams.set('token_hash', 'valid_hash');
			mockUrl.searchParams.set('type', 'signup');
			mockUrl.searchParams.set('next', '/account');

			mockSupabase.auth.verifyOtp.mockResolvedValue({
				data: {
					user: { id: 'user-123', email: 'test@example.com' }
				},
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/account');
			}

			expect(mockSupabase.auth.verifyOtp).toHaveBeenCalledWith({
				token_hash: 'valid_hash',
				type: 'signup'
			});
		});

		it('トークン検証エラー時にloginにredirect', async () => {
			mockUrl.searchParams.set('token_hash', 'invalid_hash');
			mockUrl.searchParams.set('type', 'signup');

			mockSupabase.auth.verifyOtp.mockResolvedValue({
				data: null,
				error: {
					message: 'Invalid token'
				}
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toContain('/login?error=');
			}
		});
	});

	describe('パラメータなし', () => {
		it('既存セッションがある場合dashboardにredirect', async () => {
			// パラメータなし
			mockSupabase.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user-123', email: 'test@example.com' } },
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/dashboard');
			}
		});

		it('既存セッションもパラメータもない場合loginにredirect', async () => {
			// パラメータなし
			mockSupabase.auth.getUser.mockResolvedValue({
				data: { user: null },
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toContain('/login?error=');
			}
		});
	});

	describe('組織パスのバリデーション', () => {
		it('有効なUUID v4形式の組織パスの場合そのままredirect', async () => {
			mockUrl.searchParams.set('code', 'valid_code');
			mockUrl.searchParams.set('next', '/organization/550e8400-e29b-41d4-a716-446655440000');

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: {
					user: { id: 'user-123', email: 'test@example.com' },
					session: { access_token: 'token' }
				},
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/organization/550e8400-e29b-41d4-a716-446655440000');
			}
		});

		it('パストラバーサル攻撃を含む組織パスはデフォルトにredirect', async () => {
			mockUrl.searchParams.set('code', 'valid_code');
			mockUrl.searchParams.set('next', '/organization/../../etc/passwd'); // パストラバーサル攻撃

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: {
					user: { id: 'user-123', email: 'test@example.com' },
					session: { access_token: 'token' }
				},
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/onboarding/create-organization');
			}
		});

		it('UUID v4以外のバージョン（v1）はデフォルトにredirect', async () => {
			mockUrl.searchParams.set('code', 'valid_code');
			mockUrl.searchParams.set('next', '/organization/550e8400-e29b-11d4-a716-446655440000'); // UUID v1 (3rd section starts with 1)

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: {
					user: { id: 'user-123', email: 'test@example.com' },
					session: { access_token: 'token' }
				},
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/onboarding/create-organization');
			}
		});

		it('不正なバリアント（yの位置が不正）はデフォルトにredirect', async () => {
			mockUrl.searchParams.set('code', 'valid_code');
			mockUrl.searchParams.set('next', '/organization/550e8400-e29b-41d4-f716-446655440000'); // yの位置がf（8,9,a,bのいずれでもない）

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: {
					user: { id: 'user-123', email: 'test@example.com' },
					session: { access_token: 'token' }
				},
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/onboarding/create-organization');
			}
		});

		it('ハイフンが欠けているUUIDはデフォルトにredirect', async () => {
			mockUrl.searchParams.set('code', 'valid_code');
			mockUrl.searchParams.set('next', '/organization/550e8400e29b41d4a716446655440000'); // ハイフンなし

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: {
					user: { id: 'user-123', email: 'test@example.com' },
					session: { access_token: 'token' }
				},
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/onboarding/create-organization');
			}
		});
	});

	describe('招待完了パスのバリデーション', () => {
		it('有効な招待完了パスの場合そのままredirect', async () => {
			mockUrl.searchParams.set('code', 'valid_code');
			mockUrl.searchParams.set('next', '/invite/abc123-def456/complete');

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: {
					user: { id: 'user-123', email: 'test@example.com' },
					session: { access_token: 'token' }
				},
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/invite/abc123-def456/complete');
			}
		});

		it('特殊文字を含む招待トークンはデフォルトにredirect', async () => {
			mockUrl.searchParams.set('code', 'valid_code');
			mockUrl.searchParams.set('next', '/invite/abc@123/complete'); // @は許可されていない

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: {
					user: { id: 'user-123', email: 'test@example.com' },
					session: { access_token: 'token' }
				},
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/onboarding/create-organization');
			}
		});

		it('トークンが長すぎる招待パスはデフォルトにredirect', async () => {
			mockUrl.searchParams.set('code', 'valid_code');
			const longToken = 'a'.repeat(65); // 64文字を超える
			mockUrl.searchParams.set('next', `/invite/${longToken}/complete`);

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: {
					user: { id: 'user-123', email: 'test@example.com' },
					session: { access_token: 'token' }
				},
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/onboarding/create-organization');
			}
		});

		it('completeで終わらない招待パスはデフォルトにredirect', async () => {
			mockUrl.searchParams.set('code', 'valid_code');
			mockUrl.searchParams.set('next', '/invite/abc123/invalid');

			mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
				data: {
					user: { id: 'user-123', email: 'test@example.com' },
					session: { access_token: 'token' }
				},
				error: null
			});

			try {
				await GET({
					url: mockUrl,
					locals: mockLocals
				} as any);
				expect.fail('Expected redirect to be thrown');
			} catch (err: any) {
				expect(isRedirect(err)).toBe(true);
				expect(err.status).toBe(303);
				expect(err.location).toBe('/onboarding/create-organization');
			}
		});
	});
});
