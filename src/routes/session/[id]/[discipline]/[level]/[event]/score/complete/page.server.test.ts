import { describe, it, expect, vi, beforeEach } from 'vitest';
import { actions } from './+page.server';
import { authenticateAction } from '$lib/server/sessionAuth';
import { fail, redirect } from '@sveltejs/kit';

// モジュールのモック
vi.mock('$lib/server/sessionAuth', () => ({
	authenticateAction: vi.fn(),
	authenticateSession: vi.fn()
}));

vi.mock('@sveltejs/kit', async () => {
	const actual = await vi.importActual('@sveltejs/kit');
	return {
		...actual,
		fail: vi.fn((status: number, data: any) => ({ status, data })),
		redirect: vi.fn((status: number, location: string) => {
			const error = new Error(`Redirecting to ${location}`);
			(error as any).status = status;
			(error as any).location = location;
			throw error;
		})
	};
});

describe('ルートアクション統合テスト: complete/+page.server.ts', () => {
	let mockSupabase: any;
	let mockRequest: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Supabaseモックのセットアップ
		mockSupabase = {
			from: vi.fn(() => ({
				select: vi.fn().mockReturnThis(),
				update: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn()
			}))
		};

		// Requestモックのセットアップ
		mockRequest = {
			formData: vi.fn()
		};
	});

	describe('changeEvent アクション', () => {
		it('authenticateActionがnullを返す場合は401 failを返す', async () => {
			vi.mocked(authenticateAction).mockResolvedValue(null);

			const result = await actions.changeEvent({
				params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
				locals: { supabase: mockSupabase },
				url: new URL('http://localhost?guest=guest-123'),
				request: mockRequest
			} as any);

			expect(result).toEqual({
				status: 401,
				data: { error: '認証が必要です。' }
			});
			expect(fail).toHaveBeenCalledWith(401, { error: '認証が必要です。' });
			expect(authenticateAction).toHaveBeenCalledWith(
				mockSupabase,
				'session-123',
				'guest-123'
			);
		});

		it('認証成功（ユーザー）かつ主任検定員の場合は種目変更できる', async () => {
			const mockUser = { id: 'user-123', email: 'test@example.com' };

			vi.mocked(authenticateAction).mockResolvedValue({
				user: mockUser,
				guestParticipant: null,
				guestIdentifier: null
			});

			const mockSession = {
				chief_judge_id: 'user-123',
				is_tournament_mode: false,
				is_multi_judge: true
			};

			const mockUpdate = vi.fn().mockReturnThis();
			const mockEq = vi.fn().mockResolvedValue({ data: null, error: null });

			// 1回目: sessions.select() - セッション情報取得
			// 2回目: sessions.update() - active_prompt_id をクリア
			mockSupabase.from
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
				})
				.mockReturnValueOnce({
					update: mockUpdate.mockReturnValue({
						eq: mockEq
					})
				});

			await expect(
				actions.changeEvent({
					params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
					locals: { supabase: mockSupabase },
					url: new URL('http://localhost'),
					request: mockRequest
				} as any)
			).rejects.toThrow('Redirecting to /session/session-123/men/6');

			// 検証: updateが active_prompt_id: null で呼ばれた
			expect(mockUpdate).toHaveBeenCalledWith({ active_prompt_id: null });
			// 検証: eqが session_id で呼ばれた
			expect(mockEq).toHaveBeenCalledWith('id', 'session-123');
		});

		it('認証成功（ユーザー）だが一般検定員で複数検定員モードの場合は403 failを返す', async () => {
			const mockUser = { id: 'user-456', email: 'test@example.com' };

			vi.mocked(authenticateAction).mockResolvedValue({
				user: mockUser,
				guestParticipant: null,
				guestIdentifier: null
			});

			const mockSession = {
				chief_judge_id: 'user-123', // 別のユーザーが主任
				is_tournament_mode: false,
				is_multi_judge: true
			};

			mockSupabase.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				update: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
			});

			const result = await actions.changeEvent({
				params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
				locals: { supabase: mockSupabase },
				url: new URL('http://localhost'),
				request: mockRequest
			} as any);

			expect(result).toEqual({
				status: 403,
				data: { error: '種目を変更する権限がありません。' }
			});
		});

		it('認証成功（ゲスト）で複数検定員モードOFFの場合は種目変更できる', async () => {
			const mockGuestParticipant = {
				id: 'guest-123',
				session_id: 'session-123',
				guest_identifier: 'guest-uuid-123',
				guest_name: 'ゲスト太郎',
				is_guest: true,
				created_at: '2025-01-01T00:00:00Z'
			};

			vi.mocked(authenticateAction).mockResolvedValue({
				user: null,
				guestParticipant: mockGuestParticipant,
				guestIdentifier: 'guest-uuid-123'
			});

			const mockSession = {
				chief_judge_id: 'user-123',
				is_tournament_mode: false,
				is_multi_judge: false // 複数検定員モードOFF
			};

			const mockUpdate = vi.fn().mockReturnThis();
			const mockEq = vi.fn().mockResolvedValue({ data: null, error: null });

			// 1回目: sessions.select() - セッション情報取得
			// 2回目: sessions.update() - active_prompt_id をクリア
			mockSupabase.from
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
				})
				.mockReturnValueOnce({
					update: mockUpdate.mockReturnValue({
						eq: mockEq
					})
				});

			await expect(
				actions.changeEvent({
					params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
					locals: { supabase: mockSupabase },
					url: new URL('http://localhost?guest=guest-uuid-123'),
					request: mockRequest
				} as any)
			).rejects.toThrow('Redirecting to /session/session-123/men/6?guest=guest-uuid-123&join=true');

			// 検証: updateが active_prompt_id: null で呼ばれた
			expect(mockUpdate).toHaveBeenCalledWith({ active_prompt_id: null });
			// 検証: eqが session_id で呼ばれた
			expect(mockEq).toHaveBeenCalledWith('id', 'session-123');
		});

		it('認証成功（ゲスト）だが複数検定員モードONの場合は403 failを返す', async () => {
			const mockGuestParticipant = {
				id: 'guest-123',
				session_id: 'session-123',
				guest_identifier: 'guest-uuid-123',
				guest_name: 'ゲスト太郎',
				is_guest: true,
				created_at: '2025-01-01T00:00:00Z'
			};

			vi.mocked(authenticateAction).mockResolvedValue({
				user: null,
				guestParticipant: mockGuestParticipant,
				guestIdentifier: 'guest-uuid-123'
			});

			const mockSession = {
				chief_judge_id: 'user-123',
				is_tournament_mode: false,
				is_multi_judge: true // 複数検定員モードON
			};

			mockSupabase.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				update: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
			});

			const result = await actions.changeEvent({
				params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
				locals: { supabase: mockSupabase },
				url: new URL('http://localhost?guest=guest-uuid-123'),
				request: mockRequest
			} as any);

			expect(result).toEqual({
				status: 403,
				data: { error: '種目を変更する権限がありません。' }
			});
		});

		it('大会モードの場合は tournament-events にリダイレクトする', async () => {
			const mockUser = { id: 'user-123', email: 'test@example.com' };

			vi.mocked(authenticateAction).mockResolvedValue({
				user: mockUser,
				guestParticipant: null,
				guestIdentifier: null
			});

			const mockSession = {
				chief_judge_id: 'user-123',
				is_tournament_mode: true, // 大会モード
				is_multi_judge: true
			};

			const mockUpdate = vi.fn().mockReturnThis();
			const mockEq = vi.fn().mockResolvedValue({ data: null, error: null });

			// 1回目: sessions.select() - セッション情報取得
			// 2回目: sessions.update() - active_prompt_id をクリア
			mockSupabase.from
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
				})
				.mockReturnValueOnce({
					update: mockUpdate.mockReturnValue({
						eq: mockEq
					})
				});

			await expect(
				actions.changeEvent({
					params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
					locals: { supabase: mockSupabase },
					url: new URL('http://localhost'),
					request: mockRequest
				} as any)
			).rejects.toThrow('Redirecting to /session/session-123/tournament-events');

			// 検証: updateが active_prompt_id: null で呼ばれた
			expect(mockUpdate).toHaveBeenCalledWith({ active_prompt_id: null });
			// 検証: eqが session_id で呼ばれた
			expect(mockEq).toHaveBeenCalledWith('id', 'session-123');
		});

		it('セッション取得エラーの場合は404 failを返す', async () => {
			const mockUser = { id: 'user-123', email: 'test@example.com' };

			vi.mocked(authenticateAction).mockResolvedValue({
				user: mockUser,
				guestParticipant: null,
				guestIdentifier: null
			});

			mockSupabase.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: null,
					error: { message: 'Session not found' }
				})
			});

			const result = await actions.changeEvent({
				params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
				locals: { supabase: mockSupabase },
				url: new URL('http://localhost'),
				request: mockRequest
			} as any);

			expect(result).toEqual({
				status: 404,
				data: { error: '検定が見つかりません。' }
			});
		});

		it('sessions.update()が失敗した場合は500 failを返す', async () => {
			const mockUser = { id: 'user-123', email: 'test@example.com' };

			vi.mocked(authenticateAction).mockResolvedValue({
				user: mockUser,
				guestParticipant: null,
				guestIdentifier: null
			});

			const mockSession = {
				chief_judge_id: 'user-123',
				is_tournament_mode: false,
				is_multi_judge: true
			};

			// 1回目のfrom呼び出し: sessions.select() - 成功
			// 2回目のfrom呼び出し: sessions.update() - 失敗
			mockSupabase.from
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
				})
				.mockReturnValueOnce({
					update: vi.fn().mockReturnThis(),
					eq: vi.fn().mockResolvedValue({
						data: null,
						error: { message: 'Database error during update' }
					})
				});

			const result = await actions.changeEvent({
				params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
				locals: { supabase: mockSupabase },
				url: new URL('http://localhost'),
				request: mockRequest
			} as any);

			expect(result).toEqual({
				status: 500,
				data: { error: 'セッションの更新に失敗しました。' }
			});
			expect(fail).toHaveBeenCalledWith(500, { error: 'セッションの更新に失敗しました。' });
		});
	});

	describe('endSession アクション', () => {
		it('authenticateActionがnullを返す場合は401 failを返す', async () => {
			vi.mocked(authenticateAction).mockResolvedValue(null);

			const result = await actions.endSession({
				params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
				locals: { supabase: mockSupabase },
				url: new URL('http://localhost?guest=guest-123'),
				request: mockRequest
			} as any);

			expect(result).toEqual({
				status: 401,
				data: { error: '認証が必要です。' }
			});
			expect(fail).toHaveBeenCalledWith(401, { error: '認証が必要です。' });
		});

		it('認証成功（ユーザー）かつ主任検定員の場合はセッション終了できる', async () => {
			const mockUser = { id: 'user-123', email: 'test@example.com' };

			vi.mocked(authenticateAction).mockResolvedValue({
				user: mockUser,
				guestParticipant: null,
				guestIdentifier: null
			});

			const mockSession = {
				chief_judge_id: 'user-123',
				is_multi_judge: true
			};

			const mockUpdate = vi.fn().mockReturnThis();
			const mockEq = vi.fn().mockResolvedValue({ data: null, error: null });

			// 1回目: sessions.select() - セッション情報取得
			// 2回目: sessions.update() - status, is_active, active_prompt_id を更新
			mockSupabase.from
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
				})
				.mockReturnValueOnce({
					update: mockUpdate.mockReturnValue({
						eq: mockEq
					})
				});

			await expect(
				actions.endSession({
					params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
					locals: { supabase: mockSupabase },
					url: new URL('http://localhost'),
					request: mockRequest
				} as any)
			).rejects.toThrow('Redirecting to /session/session-123?ended=true');

			// 検証: updateが正しい値で呼ばれた
			expect(mockUpdate).toHaveBeenCalledWith({
				status: 'ended',
				is_active: false,
				active_prompt_id: null
			});
			// 検証: eqが session_id で呼ばれた
			expect(mockEq).toHaveBeenCalledWith('id', 'session-123');
		});

		it('認証成功（ユーザー）だが一般検定員で複数検定員モードの場合は403 failを返す', async () => {
			const mockUser = { id: 'user-456', email: 'test@example.com' };

			vi.mocked(authenticateAction).mockResolvedValue({
				user: mockUser,
				guestParticipant: null,
				guestIdentifier: null
			});

			const mockSession = {
				chief_judge_id: 'user-123',
				is_multi_judge: true
			};

			mockSupabase.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
			});

			const result = await actions.endSession({
				params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
				locals: { supabase: mockSupabase },
				url: new URL('http://localhost'),
				request: mockRequest
			} as any);

			expect(result).toEqual({
				status: 403,
				data: { error: 'セッションを終了する権限がありません。' }
			});
		});

		it('認証成功（ゲスト）で複数検定員モードOFFの場合はセッション終了できる', async () => {
			const mockGuestParticipant = {
				id: 'guest-123',
				session_id: 'session-123',
				guest_identifier: 'guest-uuid-123',
				guest_name: 'ゲスト太郎',
				is_guest: true,
				created_at: '2025-01-01T00:00:00Z'
			};

			vi.mocked(authenticateAction).mockResolvedValue({
				user: null,
				guestParticipant: mockGuestParticipant,
				guestIdentifier: 'guest-uuid-123'
			});

			const mockSession = {
				chief_judge_id: 'user-123',
				is_multi_judge: false
			};

			const mockUpdate = vi.fn().mockReturnThis();
			const mockEq = vi.fn().mockResolvedValue({ data: null, error: null });

			// 1回目: sessions.select() - セッション情報取得
			// 2回目: sessions.update() - status, is_active, active_prompt_id を更新
			mockSupabase.from
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
				})
				.mockReturnValueOnce({
					update: mockUpdate.mockReturnValue({
						eq: mockEq
					})
				});

			await expect(
				actions.endSession({
					params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
					locals: { supabase: mockSupabase },
					url: new URL('http://localhost?guest=guest-uuid-123'),
					request: mockRequest
				} as any)
			).rejects.toThrow('Redirecting to /session/session-123?ended=true&guest=guest-uuid-123');

			// 検証: updateが正しい値で呼ばれた
			expect(mockUpdate).toHaveBeenCalledWith({
				status: 'ended',
				is_active: false,
				active_prompt_id: null
			});
			// 検証: eqが session_id で呼ばれた
			expect(mockEq).toHaveBeenCalledWith('id', 'session-123');
		});

		it('セッション取得エラーの場合は404 failを返す', async () => {
			const mockUser = { id: 'user-123', email: 'test@example.com' };

			vi.mocked(authenticateAction).mockResolvedValue({
				user: mockUser,
				guestParticipant: null,
				guestIdentifier: null
			});

			mockSupabase.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: null,
					error: { message: 'Session not found' }
				})
			});

			const result = await actions.endSession({
				params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
				locals: { supabase: mockSupabase },
				url: new URL('http://localhost'),
				request: mockRequest
			} as any);

			expect(result).toEqual({
				status: 404,
				data: { error: '検定が見つかりません。' }
			});
		});

		it('sessions.update()が失敗した場合は500 failを返す', async () => {
			const mockUser = { id: 'user-123', email: 'test@example.com' };

			vi.mocked(authenticateAction).mockResolvedValue({
				user: mockUser,
				guestParticipant: null,
				guestIdentifier: null
			});

			const mockSession = {
				chief_judge_id: 'user-123',
				is_multi_judge: true
			};

			// 1回目のfrom呼び出し: sessions.select() - 成功
			// 2回目のfrom呼び出し: sessions.update() - 失敗
			mockSupabase.from
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
				})
				.mockReturnValueOnce({
					update: vi.fn().mockReturnThis(),
					eq: vi.fn().mockResolvedValue({
						data: null,
						error: { message: 'Database error during update', code: 'DB_ERROR' }
					})
				});

			const result = await actions.endSession({
				params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
				locals: { supabase: mockSupabase },
				url: new URL('http://localhost'),
				request: mockRequest
			} as any);

			expect(result).toEqual({
				status: 500,
				data: { error: '検定の終了に失敗しました。' }
			});
			expect(fail).toHaveBeenCalledWith(500, { error: '検定の終了に失敗しました。' });
		});
	});

	describe('認証境界テスト', () => {
		it('guest識別子なしで未認証の場合は401を返す', async () => {
			vi.mocked(authenticateAction).mockResolvedValue(null);

			const result = await actions.changeEvent({
				params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
				locals: { supabase: mockSupabase },
				url: new URL('http://localhost'), // guest パラメータなし
				request: mockRequest
			} as any);

			expect(result).toEqual({
				status: 401,
				data: { error: '認証が必要です。' }
			});
			expect(authenticateAction).toHaveBeenCalledWith(mockSupabase, 'session-123', null);
		});

		it('不正なguest識別子の場合は401を返す', async () => {
			vi.mocked(authenticateAction).mockResolvedValue(null);

			const result = await actions.endSession({
				params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
				locals: { supabase: mockSupabase },
				url: new URL('http://localhost?guest=invalid-guest-id'),
				request: mockRequest
			} as any);

			expect(result).toEqual({
				status: 401,
				data: { error: '認証が必要です。' }
			});
			expect(authenticateAction).toHaveBeenCalledWith(
				mockSupabase,
				'session-123',
				'invalid-guest-id'
			);
		});

		it('別のセッションのguest識別子を使用した場合は401を返す', async () => {
			// authenticateActionがsession境界をチェックしてnullを返す
			vi.mocked(authenticateAction).mockResolvedValue(null);

			const result = await actions.changeEvent({
				params: { id: 'session-123', discipline: 'men', level: '6', event: 'pommel' },
				locals: { supabase: mockSupabase },
				url: new URL('http://localhost?guest=guest-from-other-session'),
				request: mockRequest
			} as any);

			expect(result).toEqual({
				status: 401,
				data: { error: '認証が必要です。' }
			});
		});
	});
});
