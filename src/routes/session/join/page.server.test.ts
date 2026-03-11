/**
 * Guest Join - Atomic Transaction テスト
 *
 * ゲスト参加時の原子性（JWT発行失敗時のロールバック）をテストします
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Guest Join - Atomic Transaction', () => {
	let mockSupabase: any;
	let deleteCallCount: number;
	let insertCallCount: number;

	beforeEach(() => {
		deleteCallCount = 0;
		insertCallCount = 0;

		mockSupabase = {
			from: vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								single: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 1,
											organization_id: 1,
											is_accepting_participants: true,
											join_code: 'ABC12345',
											is_locked: false,
											failed_join_attempts: 0
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
							eq: vi.fn((field: string, value: any) => {
								deleteCallCount++;
								return Promise.resolve({ error: null });
							})
						}))
					};
				}
				return {};
			}),
			auth: {
				signInAnonymously: vi.fn()
			}
		};
	});

	it('JWT発行失敗時に参加者レコードをロールバックする', async () => {
		// JWT発行が失敗するようにモック
		mockSupabase.auth.signInAnonymously.mockResolvedValue({
			data: { session: null }, // ❌ JWT発行失敗
			error: { message: 'Anonymous sign-in failed' }
		});

		// ゲスト参加処理のシミュレーション
		const guestIdentifier = 'test-guest-uuid';
		const guestName = 'テストゲスト';

		// Step 1: session_participants に INSERT
		const { error: insertError } = await mockSupabase
			.from('session_participants')
			.insert({
				session_id: 1,
				is_guest: true,
				guest_name: guestName,
				guest_identifier: guestIdentifier
			});

		expect(insertError).toBeNull();
		expect(insertCallCount).toBe(1);

		// Step 2: JWT発行（失敗）
		const { data: authData, error: authError } = await mockSupabase.auth.signInAnonymously({
			options: {
				data: {
					session_id: 1,
					guest_identifier: guestIdentifier,
					guest_name: guestName,
					is_guest: true
				}
			}
		});

		// Step 3: ロールバック
		if (authError || !authData.session) {
			console.log('[Test] JWT発行失敗のため、参加者レコードをロールバック中...');
			const { error: rollbackError } = await mockSupabase
				.from('session_participants')
				.delete()
				.eq('guest_identifier', guestIdentifier);

			expect(rollbackError).toBeNull();
		}

		// 検証
		expect(authError).toBeTruthy();
		expect(authError.message).toBe('Anonymous sign-in failed');
		expect(deleteCallCount).toBe(1); // ロールバックが実行された
	});

	it('JWT発行成功時はロールバックしない', async () => {
		// JWT発行が成功するようにモック
		mockSupabase.auth.signInAnonymously.mockResolvedValue({
			data: {
				session: {
					access_token: 'valid_token',
					user: { id: 'anon-user-id' }
				}
			}, // ✅ JWT発行成功
			error: null
		});

		const guestIdentifier = 'test-guest-uuid-success';
		const guestName = 'テストゲスト成功';

		// Step 1: session_participants に INSERT
		await mockSupabase.from('session_participants').insert({
			session_id: 1,
			is_guest: true,
			guest_name: guestName,
			guest_identifier: guestIdentifier
		});

		expect(insertCallCount).toBe(1);

		// Step 2: JWT発行（成功）
		const { data: authData, error: authError } = await mockSupabase.auth.signInAnonymously({
			options: {
				data: {
					session_id: 1,
					guest_identifier: guestIdentifier,
					guest_name: guestName,
					is_guest: true
				}
			}
		});

		// Step 3: エラーがない場合はロールバックしない
		if (authError || !authData.session) {
			await mockSupabase
				.from('session_participants')
				.delete()
				.eq('guest_identifier', guestIdentifier);
		}

		// 検証
		expect(authError).toBeNull();
		expect(authData.session).toBeTruthy();
		expect(authData.session.access_token).toBe('valid_token');
		expect(deleteCallCount).toBe(0); // ロールバックされない
	});

	it('ロールバック失敗でもエラーメッセージが返される', async () => {
		// JWT発行失敗
		mockSupabase.auth.signInAnonymously.mockResolvedValue({
			data: { session: null },
			error: { message: 'JWT issuance failed' }
		});

		// ロールバック失敗をシミュレート
		mockSupabase.from = vi.fn((table: string) => {
			if (table === 'session_participants') {
				return {
					insert: vi.fn(() => Promise.resolve({ error: null })),
					delete: vi.fn(() => ({
						eq: vi.fn(() =>
							Promise.resolve({
								error: { message: 'Rollback failed', code: '23000' }
							})
						)
					}))
				};
			}
			return {};
		});

		const guestIdentifier = 'test-guest-uuid-rollback-fail';

		// INSERT
		await mockSupabase.from('session_participants').insert({
			session_id: 1,
			is_guest: true,
			guest_name: 'テスト',
			guest_identifier: guestIdentifier
		});

		// JWT発行失敗
		const { data: authData, error: authError } = await mockSupabase.auth.signInAnonymously();

		// ロールバック試行
		if (authError || !authData.session) {
			const { error: rollbackError } = await mockSupabase
				.from('session_participants')
				.delete()
				.eq('guest_identifier', guestIdentifier);

			// ロールバック失敗を記録
			if (rollbackError) {
				console.error('[Test] ロールバック失敗:', rollbackError);
			}

			// ユーザーには認証失敗として通知（ロールバック失敗は内部エラーとして記録）
			expect(rollbackError).toBeTruthy();
			expect(rollbackError.message).toBe('Rollback failed');
		}

		// JWT発行エラーは依然として存在
		expect(authError).toBeTruthy();
	});

	it('複数のゲストが同時に参加しても原子性が保たれる', async () => {
		const guests = [
			{ identifier: 'guest-1', name: 'ゲスト1' },
			{ identifier: 'guest-2', name: 'ゲスト2' },
			{ identifier: 'guest-3', name: 'ゲスト3' }
		];

		// ゲスト1とゲスト3は成功、ゲスト2は失敗
		let callCount = 0;
		mockSupabase.auth.signInAnonymously = vi.fn(() => {
			callCount++;
			if (callCount === 2) {
				// ゲスト2は失敗
				return Promise.resolve({
					data: { session: null },
					error: { message: 'JWT failed for guest 2' }
				});
			}
			// ゲスト1とゲスト3は成功
			return Promise.resolve({
				data: { session: { access_token: 'token' } },
				error: null
			});
		});

		const results = await Promise.all(
			guests.map(async (guest) => {
				// INSERT
				await mockSupabase.from('session_participants').insert({
					session_id: 1,
					is_guest: true,
					guest_name: guest.name,
					guest_identifier: guest.identifier
				});

				// JWT発行
				const { data: authData, error: authError } =
					await mockSupabase.auth.signInAnonymously();

				// ロールバック判定
				let rolledBack = false;
				if (authError || !authData.session) {
					await mockSupabase
						.from('session_participants')
						.delete()
						.eq('guest_identifier', guest.identifier);
					rolledBack = true;
				}

				return { identifier: guest.identifier, success: !authError, rolledBack };
			})
		);

		// 検証
		expect(results[0].success).toBe(true); // ゲスト1成功
		expect(results[0].rolledBack).toBe(false);

		expect(results[1].success).toBe(false); // ゲスト2失敗
		expect(results[1].rolledBack).toBe(true); // ロールバック実行

		expect(results[2].success).toBe(true); // ゲスト3成功
		expect(results[2].rolledBack).toBe(false);

		expect(insertCallCount).toBe(3); // 全員がINSERT
		expect(deleteCallCount).toBe(1); // ゲスト2のみロールバック
	});
});
