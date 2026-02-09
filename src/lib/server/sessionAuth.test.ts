import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticateSession, authenticateAction } from './sessionAuth';
import { createMockSupabaseClient } from './test-utils';
import { redirect } from '@sveltejs/kit';

// @sveltejs/kit のモック
vi.mock('@sveltejs/kit', () => ({
	redirect: vi.fn((status: number, location: string) => {
		const error = new Error(`Redirecting to ${location}`);
		(error as any).status = status;
		(error as any).location = location;
		throw error;
	})
}));

describe('sessionAuth', () => {
	let mockSupabase: any;
	let mocks: any;

	beforeEach(() => {
		vi.clearAllMocks();
		const clientMock = createMockSupabaseClient();
		mockSupabase = clientMock.supabase;
		mocks = clientMock.mocks;
	});

	describe('authenticateSession', () => {
		it('有効なログインユーザーの場合はuserを返す', async () => {
			const mockUser = {
				id: 'user-123',
				email: 'test@example.com'
			};

			mocks.getUser.mockResolvedValue({
				data: { user: mockUser },
				error: null
			});

			const result = await authenticateSession(mockSupabase, 'session-123', null);

			expect(result.user).toEqual(mockUser);
			expect(result.guestParticipant).toBeNull();
			expect(result.guestIdentifier).toBeNull();
		});

		it('有効なゲスト参加者の場合はguestParticipantを返す', async () => {
			const mockGuestParticipant = {
				id: 'guest-123',
				session_id: 'session-123',
				guest_identifier: 'guest-uuid-123',
				guest_name: 'ゲスト太郎',
				is_guest: true,
				created_at: '2025-01-01T00:00:00Z'
			};

			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			mocks.single.mockResolvedValue({
				data: mockGuestParticipant,
				error: null
			});

			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			});

			const result = await authenticateSession(
				mockSupabase,
				'session-123',
				'guest-uuid-123'
			);

			expect(result.user).toBeNull();
			expect(result.guestParticipant).toEqual(mockGuestParticipant);
			expect(result.guestIdentifier).toBe('guest-uuid-123');
			expect(mocks.from).toHaveBeenCalledWith('session_participants');
		});

		it('ユーザーもゲストも認証できない場合は/loginにリダイレクト', async () => {
			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			await expect(
				authenticateSession(mockSupabase, 'session-123', null)
			).rejects.toThrow('Redirecting to /login');

			expect(redirect).toHaveBeenCalledWith(303, '/login');
		});

		it('ゲスト識別子が無効な場合は/session/joinにリダイレクト', async () => {
			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			mocks.single.mockResolvedValue({
				data: null,
				error: { message: 'Guest not found' }
			});

			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			});

			await expect(
				authenticateSession(mockSupabase, 'session-123', 'invalid-guest-id')
			).rejects.toThrow('Redirecting to /session/join');

			expect(redirect).toHaveBeenCalledWith(303, '/session/join');
		});

		it('ゲスト識別子がsession_idと一致しない場合は/session/joinにリダイレクト', async () => {
			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			mocks.single.mockResolvedValue({
				data: null,
				error: { message: 'Not found' }
			});

			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			});

			await expect(
				authenticateSession(mockSupabase, 'session-123', 'guest-from-other-session')
			).rejects.toThrow('Redirecting to /session/join');

			expect(mocks.from).toHaveBeenCalledWith('session_participants');
		});
	});

	describe('authenticateAction', () => {
		it('有効なログインユーザーの場合はuserを返す', async () => {
			const mockUser = {
				id: 'user-123',
				email: 'test@example.com'
			};

			mocks.getUser.mockResolvedValue({
				data: { user: mockUser },
				error: null
			});

			const result = await authenticateAction(mockSupabase, 'session-123', null);

			expect(result).not.toBeNull();
			expect(result?.user).toEqual(mockUser);
			expect(result?.guestParticipant).toBeNull();
			expect(result?.guestIdentifier).toBeNull();
		});

		it('有効なゲスト参加者の場合はguestParticipantを返す', async () => {
			const mockGuestParticipant = {
				id: 'guest-123',
				session_id: 'session-123',
				guest_identifier: 'guest-uuid-123',
				guest_name: 'ゲスト太郎',
				is_guest: true,
				created_at: '2025-01-01T00:00:00Z'
			};

			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			mocks.single.mockResolvedValue({
				data: mockGuestParticipant,
				error: null
			});

			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			});

			const result = await authenticateAction(
				mockSupabase,
				'session-123',
				'guest-uuid-123'
			);

			expect(result).not.toBeNull();
			expect(result?.user).toBeNull();
			expect(result?.guestParticipant).toEqual(mockGuestParticipant);
			expect(result?.guestIdentifier).toBe('guest-uuid-123');
		});

		it('ユーザーもゲストも認証できない場合はnullを返す（リダイレクトしない）', async () => {
			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			const result = await authenticateAction(mockSupabase, 'session-123', null);

			expect(result).toBeNull();
			expect(redirect).not.toHaveBeenCalled();
		});

		it('ゲスト識別子が無効な場合はnullを返す（リダイレクトしない）', async () => {
			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			mocks.single.mockResolvedValue({
				data: null,
				error: { message: 'Guest not found' }
			});

			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			});

			const result = await authenticateAction(
				mockSupabase,
				'session-123',
				'invalid-guest-id'
			);

			expect(result).toBeNull();
			expect(redirect).not.toHaveBeenCalled();
		});

		it('session_idとguest_identifierの両方を検証する', async () => {
			const mockGuestParticipant = {
				id: 'guest-123',
				session_id: 'session-456',
				guest_identifier: 'guest-uuid-456',
				guest_name: 'ゲスト次郎',
				is_guest: true,
				created_at: '2025-01-01T00:00:00Z'
			};

			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			mocks.single.mockResolvedValue({
				data: mockGuestParticipant,
				error: null
			});

			const mockEq = vi.fn().mockReturnThis();
			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: mockEq,
				single: mocks.single
			});

			const result = await authenticateAction(
				mockSupabase,
				'session-456',
				'guest-uuid-456'
			);

			expect(result).not.toBeNull();
			expect(result?.guestParticipant?.session_id).toBe('session-456');
			expect(result?.guestParticipant?.guest_identifier).toBe('guest-uuid-456');
			// session_id, guest_identifier, is_guest の3つの条件で検証していることを確認
			expect(mockEq).toHaveBeenCalledWith('session_id', 'session-456');
			expect(mockEq).toHaveBeenCalledWith('guest_identifier', 'guest-uuid-456');
			expect(mockEq).toHaveBeenCalledWith('is_guest', true);
		});

		it('ログインユーザーが存在する場合はguestIdentifierを無視する', async () => {
			const mockUser = {
				id: 'user-123',
				email: 'test@example.com'
			};

			mocks.getUser.mockResolvedValue({
				data: { user: mockUser },
				error: null
			});

			// guestIdentifierが渡されているが、ユーザーが優先される
			const result = await authenticateAction(
				mockSupabase,
				'session-123',
				'guest-uuid-123'
			);

			expect(result).not.toBeNull();
			expect(result?.user).toEqual(mockUser);
			expect(result?.guestParticipant).toBeNull();
			// ゲストクエリは実行されない
			expect(mocks.from).not.toHaveBeenCalled();
		});

		it('異なるsession_idのゲストデータは認証失敗', async () => {
			const mockGuestFromOtherSession = {
				id: 'guest-999',
				session_id: 'session-999', // 異なるセッション
				guest_identifier: 'guest-uuid-123',
				guest_name: 'ゲスト太郎',
				is_guest: true,
				created_at: '2025-01-01T00:00:00Z'
			};

			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			// session_idが一致しないのでデータが返らない想定
			mocks.single.mockResolvedValue({
				data: null,
				error: { message: 'Not found' }
			});

			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			});

			const result = await authenticateAction(
				mockSupabase,
				'session-123',
				'guest-uuid-123'
			);

			expect(result).toBeNull();
		});

		it('is_guest=falseのデータは認証失敗（セキュリティ境界）', async () => {
			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			// is_guest=trueのフィルタでデータが返らない
			mocks.single.mockResolvedValue({
				data: null,
				error: { message: 'Not found' }
			});

			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			});

			const result = await authenticateAction(
				mockSupabase,
				'session-123',
				'regular-participant-id'
			);

			expect(result).toBeNull();
		});

		it('空文字列のguestIdentifierは認証失敗', async () => {
			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			const result = await authenticateAction(mockSupabase, 'session-123', '');

			expect(result).toBeNull();
			expect(redirect).not.toHaveBeenCalled();
		});

		it('データベースエラーが発生した場合はnullを返す', async () => {
			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			mocks.single.mockResolvedValue({
				data: null,
				error: { message: 'Database connection failed' }
			});

			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			});

			const result = await authenticateAction(
				mockSupabase,
				'session-123',
				'guest-uuid-123'
			);

			expect(result).toBeNull();
			expect(redirect).not.toHaveBeenCalled();
		});

		it('複数プロパティを持つユーザーオブジェクトを正しく返す', async () => {
			const mockUser = {
				id: 'user-123',
				email: 'test@example.com',
				aud: 'authenticated',
				role: 'authenticated',
				created_at: '2025-01-01T00:00:00Z',
				updated_at: '2025-01-01T00:00:00Z'
			};

			mocks.getUser.mockResolvedValue({
				data: { user: mockUser },
				error: null
			});

			const result = await authenticateAction(mockSupabase, 'session-123', null);

			expect(result).not.toBeNull();
			expect(result?.user).toEqual(mockUser);
			expect(result?.user?.id).toBe('user-123');
			expect(result?.user?.email).toBe('test@example.com');
		});

		it('guestParticipantの全プロパティを正しく返す', async () => {
			const mockGuestParticipant = {
				id: 'guest-123',
				session_id: 'session-123',
				guest_identifier: 'guest-uuid-123',
				guest_name: 'ゲスト太郎',
				is_guest: true,
				created_at: '2025-01-01T00:00:00Z'
			};

			mocks.getUser.mockResolvedValue({
				data: { user: null },
				error: { message: 'Not authenticated' }
			});

			mocks.single.mockResolvedValue({
				data: mockGuestParticipant,
				error: null
			});

			mocks.from.mockReturnValue({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				single: mocks.single
			});

			const result = await authenticateAction(
				mockSupabase,
				'session-123',
				'guest-uuid-123'
			);

			expect(result).not.toBeNull();
			expect(result?.guestParticipant).toEqual(mockGuestParticipant);
			expect(result?.guestParticipant?.id).toBe('guest-123');
			expect(result?.guestParticipant?.guest_name).toBe('ゲスト太郎');
			expect(result?.guestParticipant?.is_guest).toBe(true);
		});
	});

	describe('getUser 例外系テスト', () => {
		describe('authenticateSession', () => {

			it('getUser()がdata.user=nullで返す場合は/loginにリダイレクト', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: null
				});

				await expect(
					authenticateSession(mockSupabase, 'session-123', null)
				).rejects.toThrow('Redirecting to /login');
			});

			it('getUser()が例外をスローする場合はtry-catchで捕捉して/loginにリダイレクト', async () => {
				mocks.getUser.mockRejectedValue(new Error('Network error'));

				await expect(
					authenticateSession(mockSupabase, 'session-123', null)
				).rejects.toThrow('Redirecting to /login');
			});

			it('getUser()がエラーオブジェクトを返す場合は/loginにリダイレクト', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Token expired', status: 401 }
				});

				await expect(
					authenticateSession(mockSupabase, 'session-123', null)
				).rejects.toThrow('Redirecting to /login');
			});

			it('getUser()が空のエラーオブジェクトを返す場合は/loginにリダイレクト', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: {}
				});

				await expect(
					authenticateSession(mockSupabase, 'session-123', null)
				).rejects.toThrow('Redirecting to /login');
			});

			it('getUser()がuserとerrorの両方を返す場合はerrorを優先して/loginにリダイレクト', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: { id: 'user-123', email: 'test@example.com' } },
					error: { message: 'Concurrent request error' }
				});

				await expect(
					authenticateSession(mockSupabase, 'session-123', null)
				).rejects.toThrow('Redirecting to /login');
			});

			it('getUser()が特定のエラーコード(JWT_EXPIRED)を返す場合は/loginにリダイレクト', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: {
						message: 'JWT expired',
						name: 'AuthSessionMissingError',
						status: 401
					}
				});

				await expect(
					authenticateSession(mockSupabase, 'session-123', null)
				).rejects.toThrow('Redirecting to /login');
			});

			it('getUser()が複数フィールドを持つエラーを返す場合は/loginにリダイレクト', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: {
						message: 'Invalid token',
						code: 'INVALID_JWT',
						status: 401,
						details: 'Token signature verification failed'
					}
				});

				await expect(
					authenticateSession(mockSupabase, 'session-123', null)
				).rejects.toThrow('Redirecting to /login');
			});

			it('getUser()が不完全なuserオブジェクトを返す場合でも成功する', async () => {
				const incompleteUser = {
					id: 'user-123'
					// emailなど他のプロパティなし
				};

				mocks.getUser.mockResolvedValue({
					data: { user: incompleteUser },
					error: null
				});

				const result = await authenticateSession(mockSupabase, 'session-123', null);

				expect(result.user).toEqual(incompleteUser);
				expect(redirect).not.toHaveBeenCalled();
			});
		});

		describe('authenticateAction', () => {

			it('getUser()が例外をスローする場合はtry-catchで捕捉してnullを返す', async () => {
				mocks.getUser.mockRejectedValue(new Error('Network timeout'));


			const result = await authenticateAction(mockSupabase, 'session-123', null);

			expect(result).toBeNull();
			});

			it('getUser()がエラーオブジェクトを返す場合はnullを返す', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Session expired', code: 'SESSION_EXPIRED' }
				});

				const result = await authenticateAction(mockSupabase, 'session-123', null);

				expect(result).toBeNull();
			});

			it('getUser()がuserとerrorの両方を返す場合はerrorを優先してnullを返す', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: { id: 'user-123', email: 'test@example.com' } },
					error: { message: 'Stale token' }
				});

				const result = await authenticateAction(mockSupabase, 'session-123', null);

				expect(result).toBeNull();
			});

			it('getUser()が不完全なuserオブジェクトを返す場合でも成功する', async () => {
				const incompleteUser = {
					id: 'user-456'
					// 最小限のプロパティのみ
				};

				mocks.getUser.mockResolvedValue({
					data: { user: incompleteUser },
					error: null
				});

				const result = await authenticateAction(mockSupabase, 'session-123', null);

				expect(result).not.toBeNull();
				expect(result?.user).toEqual(incompleteUser);
			});

			it('getUser()が特定のエラーコード(REFRESH_TOKEN_EXPIRED)を返す場合はnullを返す', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: {
						message: 'Refresh token expired',
						code: 'REFRESH_TOKEN_EXPIRED',
						status: 401
					}
				});

				const result = await authenticateAction(mockSupabase, 'session-123', null);

				expect(result).toBeNull();
			});

			it('getUser()が複数フィールドを持つエラーを返す場合はnullを返す', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: {
						message: 'Token validation failed',
						code: 'INVALID_TOKEN',
						status: 403,
						name: 'AuthError',
						details: { reason: 'Signature mismatch' }
					}
				});

				const result = await authenticateAction(mockSupabase, 'session-123', null);

				expect(result).toBeNull();
			});

			it('getUser()が空のerrorオブジェクトを返す場合はnullを返す', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: {} // 空のエラーオブジェクト
				});

				const result = await authenticateAction(mockSupabase, 'session-123', null);

				expect(result).toBeNull();
			});
		});
	});

	describe('セッション境界検証 (session_id と guest_identifier)', () => {
		describe('authenticateSession', () => {
			it('正しいsession_idとguest_identifierの組み合わせは成功', async () => {
				const mockGuestParticipant = {
					id: 'guest-123',
					session_id: 'session-abc',
					guest_identifier: 'guest-uuid-abc',
					guest_name: 'ゲスト太郎',
					is_guest: true,
					created_at: '2025-01-01T00:00:00Z'
				};

				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				mocks.single.mockResolvedValue({
					data: mockGuestParticipant,
					error: null
				});

				mocks.from.mockReturnValue({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: mocks.single
				});

				const result = await authenticateSession(
					mockSupabase,
					'session-abc',
					'guest-uuid-abc'
				);

				expect(result.guestParticipant).toEqual(mockGuestParticipant);
				expect(result.guestParticipant?.session_id).toBe('session-abc');
			});

			it('別のセッションIDのguest_identifierは/session/joinにリダイレクト', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				// session-xyzのguest_identifierを、session-abcで使おうとする
				// データベースは session_id='session-abc' で検索するので、データが見つからない
				mocks.single.mockResolvedValue({
					data: null,
					error: { message: 'Not found' }
				});

				mocks.from.mockReturnValue({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: mocks.single
				});

				await expect(
					authenticateSession(
						mockSupabase,
						'session-abc',
						'guest-uuid-from-session-xyz'
					)
				).rejects.toThrow('Redirecting to /session/join');

				expect(redirect).toHaveBeenCalledWith(303, '/session/join');
			});

			it('正しいsession_idでも異なるguest_identifierは/session/joinにリダイレクト', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				// session-abcは正しいが、guest_identifierが異なる
				mocks.single.mockResolvedValue({
					data: null,
					error: { message: 'Not found' }
				});

				mocks.from.mockReturnValue({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: mocks.single
				});

				await expect(
					authenticateSession(
						mockSupabase,
						'session-abc',
						'wrong-guest-identifier'
					)
				).rejects.toThrow('Redirecting to /session/join');
			});

			it('nullのguest_identifierは/loginにリダイレクト', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				await expect(
					authenticateSession(mockSupabase, 'session-abc', null)
				).rejects.toThrow('Redirecting to /login');

				expect(redirect).toHaveBeenCalledWith(303, '/login');
			});

			it('空文字列のguest_identifierは/loginにリダイレクト', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				await expect(
					authenticateSession(mockSupabase, 'session-abc', '')
				).rejects.toThrow('Redirecting to /login');
			});
		});

		describe('authenticateAction', () => {
			it('正しいsession_idとguest_identifierの組み合わせは成功', async () => {
				const mockGuestParticipant = {
					id: 'guest-456',
					session_id: 'session-xyz',
					guest_identifier: 'guest-uuid-xyz',
					guest_name: 'ゲスト花子',
					is_guest: true,
					created_at: '2025-01-01T00:00:00Z'
				};

				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				mocks.single.mockResolvedValue({
					data: mockGuestParticipant,
					error: null
				});

				mocks.from.mockReturnValue({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: mocks.single
				});

				const result = await authenticateAction(
					mockSupabase,
					'session-xyz',
					'guest-uuid-xyz'
				);

				expect(result).not.toBeNull();
				expect(result?.guestParticipant).toEqual(mockGuestParticipant);
				expect(result?.guestParticipant?.session_id).toBe('session-xyz');
			});

			it('別のセッションIDのguest_identifierはnullを返す', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				// session-pqrのguest_identifierを、session-xyzで使おうとする
				mocks.single.mockResolvedValue({
					data: null,
					error: { message: 'Not found' }
				});

				mocks.from.mockReturnValue({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: mocks.single
				});

				const result = await authenticateAction(
					mockSupabase,
					'session-xyz',
					'guest-uuid-from-session-pqr'
				);

				expect(result).toBeNull();
				expect(redirect).not.toHaveBeenCalled();
			});

			it('正しいsession_idでも異なるguest_identifierはnullを返す', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				mocks.single.mockResolvedValue({
					data: null,
					error: { message: 'Not found' }
				});

				mocks.from.mockReturnValue({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: mocks.single
				});

				const result = await authenticateAction(
					mockSupabase,
					'session-xyz',
					'wrong-guest-identifier'
				);

				expect(result).toBeNull();
			});

			it('nullのguest_identifierはnullを返す', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				const result = await authenticateAction(mockSupabase, 'session-xyz', null);

				expect(result).toBeNull();
				expect(redirect).not.toHaveBeenCalled();
			});

			it('空文字列のguest_identifierはnullを返す', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				const result = await authenticateAction(mockSupabase, 'session-xyz', '');

				expect(result).toBeNull();
			});

			it('session_id、guest_identifier、is_guestの3条件すべてでクエリされる', async () => {
				const mockGuestParticipant = {
					id: 'guest-789',
					session_id: 'session-test',
					guest_identifier: 'guest-uuid-test',
					guest_name: 'テストゲスト',
					is_guest: true,
					created_at: '2025-01-01T00:00:00Z'
				};

				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				mocks.single.mockResolvedValue({
					data: mockGuestParticipant,
					error: null
				});

				const mockEq = vi.fn().mockReturnThis();
				mocks.from.mockReturnValue({
					select: vi.fn().mockReturnThis(),
					eq: mockEq,
					single: mocks.single
				});

				await authenticateAction(
					mockSupabase,
					'session-test',
					'guest-uuid-test'
				);

				// 3つの条件すべてでeqが呼ばれることを確認
				expect(mockEq).toHaveBeenCalledWith('session_id', 'session-test');
				expect(mockEq).toHaveBeenCalledWith('guest_identifier', 'guest-uuid-test');
				expect(mockEq).toHaveBeenCalledWith('is_guest', true);
				expect(mockEq).toHaveBeenCalledTimes(3);
			});
		});

		describe('クロスセッション攻撃の防御', () => {
			it('session-Aのguest_identifierでsession-Bにアクセスできない（authenticateSession）', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				// session-Aのguest_identifierを持っているが、session-Bにアクセスしようとする
				// DBクエリは session_id='session-B' AND guest_identifier='guest-from-session-A' となり、
				// マッチするデータがないため失敗する
				mocks.single.mockResolvedValue({
					data: null,
					error: { message: 'Not found' }
				});

				mocks.from.mockReturnValue({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: mocks.single
				});

				await expect(
					authenticateSession(
						mockSupabase,
						'session-B',
						'guest-identifier-from-session-A'
					)
				).rejects.toThrow('Redirecting to /session/join');
			});

			it('session-Aのguest_identifierでsession-Bにアクセスできない（authenticateAction）', async () => {
				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				mocks.single.mockResolvedValue({
					data: null,
					error: { message: 'Not found' }
				});

				mocks.from.mockReturnValue({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: mocks.single
				});

				const result = await authenticateAction(
					mockSupabase,
					'session-B',
					'guest-identifier-from-session-A'
				);

				expect(result).toBeNull();
			});

			it('同じguest_identifierが異なるセッションに存在しても混同しない', async () => {
				// セッションAのゲスト
				const guestInSessionA = {
					id: 'guest-in-A',
					session_id: 'session-A',
					guest_identifier: 'same-guest-id',
					guest_name: 'セッションAのゲスト',
					is_guest: true,
					created_at: '2025-01-01T00:00:00Z'
				};

				mocks.getUser.mockResolvedValue({
					data: { user: null },
					error: { message: 'Not authenticated' }
				});

				// session-Aで認証する場合
				mocks.single.mockResolvedValue({
					data: guestInSessionA,
					error: null
				});

				mocks.from.mockReturnValue({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: mocks.single
				});

				const resultA = await authenticateAction(
					mockSupabase,
					'session-A',
					'same-guest-id'
				);

				expect(resultA?.guestParticipant?.session_id).toBe('session-A');
				expect(resultA?.guestParticipant?.guest_name).toBe('セッションAのゲスト');
			});
		});
	});
});
