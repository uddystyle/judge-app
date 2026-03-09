import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { actions, load } from './+page.server';

describe('/reset-password/confirm', () => {
	let mockSupabase: any;
	let mockRequest: Request;
	let mockLocals: any;

	beforeEach(() => {
		// Supabaseクライアントのモック
		mockSupabase = {
			auth: {
				getUser: vi.fn(),
				updateUser: vi.fn(),
				signOut: vi.fn()
			}
		};

		mockLocals = {
			supabase: mockSupabase
		};
	});

	describe('load function', () => {
		it('should return user when authenticated', async () => {
			const mockUser = { id: 'user-123', email: 'test@example.com' };
			mockSupabase.auth.getUser.mockResolvedValue({
				data: { user: mockUser },
				error: null
			});

			const mockUrl = new URL('http://localhost/reset-password/confirm');

			const result = await load({
				url: mockUrl,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(result).toEqual({ user: mockUser });
		});

		it('should return error when user is not authenticated', async () => {
			mockSupabase.auth.getUser.mockResolvedValue({
				data: { user: null },
				error: null
			});

			const mockUrl = new URL('http://localhost/reset-password/confirm');

			const result = await load({
				url: mockUrl,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(result).toMatchObject({
				error: expect.stringContaining('無効')
			});
		});

		it('should return error when URL contains error parameter', async () => {
			const mockUrl = new URL('http://localhost/reset-password/confirm?error=access_denied&error_description=Invalid+token');

			const result = await load({
				url: mockUrl,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(result).toEqual({
				error: 'Invalid token'
			});
		});
	});

	describe('default action', () => {
		it('should update password successfully', async () => {
			const formData = new FormData();
			formData.append('password', 'newpassword123');
			formData.append('confirmPassword', 'newpassword123');

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			mockSupabase.auth.updateUser.mockResolvedValue({ error: null });
			mockSupabase.auth.signOut.mockResolvedValue({ error: null });

			const result = actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			await expect(result).rejects.toMatchObject({
				status: 303,
				location: '/login?success=password-reset'
			});

			expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({
				password: 'newpassword123'
			});
			expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
		});

		it('should reject when passwords do not match', async () => {
			const formData = new FormData();
			formData.append('password', 'password123');
			formData.append('confirmPassword', 'different456');

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			const result = await actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(mockSupabase.auth.updateUser).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				status: 400,
				data: {
					error: 'パスワードが一致しません。'
				}
			});
		});

		it('should reject password shorter than 6 characters', async () => {
			const formData = new FormData();
			formData.append('password', '12345');
			formData.append('confirmPassword', '12345');

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			const result = await actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(mockSupabase.auth.updateUser).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				status: 400,
				data: {
					error: expect.stringContaining('6文字以上')
				}
			});
		});

		it('should reject password longer than 72 characters', async () => {
			const longPassword = 'a'.repeat(73);
			const formData = new FormData();
			formData.append('password', longPassword);
			formData.append('confirmPassword', longPassword);

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			const result = await actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(mockSupabase.auth.updateUser).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				status: 400,
				data: {
					error: expect.stringContaining('72文字以内')
				}
			});
		});

		it('should handle same_password error', async () => {
			const formData = new FormData();
			formData.append('password', 'samepassword');
			formData.append('confirmPassword', 'samepassword');

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			mockSupabase.auth.updateUser.mockResolvedValue({
				error: { code: 'same_password', message: 'New password should be different' }
			});

			const result = await actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(result).toMatchObject({
				status: 400,
				data: {
					error: expect.stringContaining('以前のパスワードと異なる')
				}
			});
		});

		it('should handle general update error', async () => {
			const formData = new FormData();
			formData.append('password', 'newpassword123');
			formData.append('confirmPassword', 'newpassword123');

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			mockSupabase.auth.updateUser.mockResolvedValue({
				error: { message: 'Network error' }
			});

			const result = await actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(result).toMatchObject({
				status: 500,
				data: {
					error: expect.stringContaining('更新に失敗')
				}
			});
		});

		it('should reject empty password', async () => {
			const formData = new FormData();
			formData.append('password', '');
			formData.append('confirmPassword', '');

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			const result = await actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(mockSupabase.auth.updateUser).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				status: 400
			});
		});
	});
});
