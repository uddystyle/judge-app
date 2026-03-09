import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { actions } from './+page.server';

describe('/reset-password actions', () => {
	let mockSupabase: any;
	let mockRequest: Request;
	let mockLocals: any;

	beforeEach(() => {
		// Supabaseクライアントのモック
		mockSupabase = {
			auth: {
				resetPasswordForEmail: vi.fn()
			}
		};

		mockLocals = {
			supabase: mockSupabase
		};
	});

	describe('default action', () => {
		it('should send reset password email for valid email', async () => {
			const formData = new FormData();
			formData.append('email', 'test@example.com');

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });

			const result = await actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(mockSupabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
				'test@example.com',
				expect.objectContaining({
					redirectTo: expect.stringContaining('/auth/callback?next=/reset-password/confirm')
				})
			);
			expect(result).toEqual({
				success: true,
				email: 'test@example.com'
			});
		});

		it('should normalize email address', async () => {
			const formData = new FormData();
			formData.append('email', '  TEST@EXAMPLE.COM  ');

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });

			const result = await actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(mockSupabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
				'test@example.com',
				expect.any(Object)
			);
			expect(result).toEqual({
				success: true,
				email: 'test@example.com'
			});
		});

		it('should reject invalid email format', async () => {
			const formData = new FormData();
			formData.append('email', 'invalid-email');

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			const result = await actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(mockSupabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				status: 400,
				data: {
					email: 'invalid-email',
					error: expect.stringContaining('メールアドレス')
				}
			});
		});

		it('should reject empty email', async () => {
			const formData = new FormData();
			formData.append('email', '');

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			const result = await actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			expect(mockSupabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				status: 400
			});
		});

		it('should return success even when Supabase returns error (security measure)', async () => {
			const formData = new FormData();
			formData.append('email', 'nonexistent@example.com');

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({
				error: { message: 'User not found' }
			});

			const result = await actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			// セキュリティ上の理由で、常に成功を返す
			expect(result).toEqual({
				success: true,
				email: 'nonexistent@example.com'
			});
		});

		it('should sanitize email input', async () => {
			const formData = new FormData();
			formData.append('email', 'test<script>@example.com');

			mockRequest = new Request('http://localhost', {
				method: 'POST',
				body: formData
			});

			mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });

			const result = await actions.default({
				request: mockRequest,
				locals: mockLocals
			} as unknown as RequestEvent);

			// サニタイズされたメールアドレスが使用される
			expect(mockSupabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
				'testscript@example.com',
				expect.any(Object)
			);
		});
	});
});
