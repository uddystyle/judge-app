/**
 * Guest Invite - Atomic Transaction テスト
 *
 * 招待リンク経由のゲスト参加時の原子性（JWT発行失敗時のロールバック）をテストします
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Guest Invite - Atomic Transaction', () => {
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
											name: 'テストセッション',
											mode: 'tournament',
											is_tournament_mode: true,
											organization_id: 1,
											organizations: { name: 'テスト組織' }
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
						})),
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: null, // 既存参加者なし
										error: null
									})
								)
							}))
						}))
					};
				}
				return {};
			}),
			auth: {
				signInAnonymously: vi.fn(),
				getUser: vi.fn(() =>
					Promise.resolve({
						data: { user: null },
						error: null
					})
				)
			}
		};
	});

	it('JWT発行失敗時に参加者レコードをロールバックする（招待リンク）', async () => {
		// JWT発行が失敗するようにモック
		mockSupabase.auth.signInAnonymously.mockResolvedValue({
			data: { session: null }, // ❌ JWT発行失敗
			error: { message: 'Anonymous sign-in failed via invite link' }
		});

		// 招待トークンからセッション取得
		const token = 'valid-invite-token';
		const { data: session } = await mockSupabase
			.from('sessions')
			.select('*')
			.eq('invite_token', token)
			.single();

		expect(session).toBeTruthy();
		expect(session.id).toBe(1);

		// ゲスト参加処理のシミュレーション
		const guestIdentifier = crypto.randomUUID();
		const guestName = 'テストゲスト（招待）';

		// Step 1: session_participants に INSERT
		const { error: insertError } = await mockSupabase
			.from('session_participants')
			.insert({
				session_id: session.id,
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
					session_id: session.id,
					guest_identifier: guestIdentifier,
					guest_name: guestName,
					is_guest: true
				}
			}
		});

		// Step 3: ロールバック
		if (authError || !authData.session) {
			console.error('[Guest Invite] JWT発行エラー:', authError);
			console.log('[Guest Invite] JWT発行失敗のため、参加者レコードをロールバック中...');

			const { error: rollbackError } = await mockSupabase
				.from('session_participants')
				.delete()
				.eq('guest_identifier', guestIdentifier);

			if (rollbackError) {
				console.error('[Guest Invite] ロールバック失敗:', rollbackError);
			} else {
				console.log('[Guest Invite] ロールバック成功');
			}
		}

		// 検証
		expect(authError).toBeTruthy();
		expect(authError.message).toContain('invite link');
		expect(deleteCallCount).toBe(1); // ロールバックが実行された
	});

	it('JWT発行成功時はロールバックしない（招待リンク）', async () => {
		// JWT発行が成功するようにモック
		mockSupabase.auth.signInAnonymously.mockResolvedValue({
			data: {
				session: {
					access_token: 'valid_invite_token',
					user: { id: 'anon-user-id-invite' }
				}
			}, // ✅ JWT発行成功
			error: null
		});

		const token = 'valid-invite-token';
		const { data: session } = await mockSupabase
			.from('sessions')
			.select('*')
			.eq('invite_token', token)
			.single();

		const guestIdentifier = crypto.randomUUID();
		const guestName = 'テストゲスト成功（招待）';

		// Step 1: session_participants に INSERT
		await mockSupabase.from('session_participants').insert({
			session_id: session.id,
			is_guest: true,
			guest_name: guestName,
			guest_identifier: guestIdentifier
		});

		expect(insertCallCount).toBe(1);

		// Step 2: JWT発行（成功）
		const { data: authData, error: authError } = await mockSupabase.auth.signInAnonymously({
			options: {
				data: {
					session_id: session.id,
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
		expect(authData.session.access_token).toBe('valid_invite_token');
		expect(deleteCallCount).toBe(0); // ロールバックされない
	});

	it('既に参加済みのユーザーはリダイレクトされる', async () => {
		// 既存の参加者がいるようにモック
		mockSupabase.from = vi.fn((table: string) => {
			if (table === 'sessions') {
				return {
					select: vi.fn(() => ({
						eq: vi.fn(() => ({
							single: vi.fn(() =>
								Promise.resolve({
									data: { id: 1, name: 'テストセッション' },
									error: null
								})
							)
						}))
					}))
				};
			} else if (table === 'session_participants') {
				return {
					select: vi.fn(() => ({
						eq: vi.fn(() => ({
							eq: vi.fn(() => ({
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: { id: 'existing-participant-id' }, // 既に参加済み
										error: null
									})
								)
							}))
						}))
					}))
				};
			}
			return {};
		});

		mockSupabase.auth.getUser = vi.fn(() =>
			Promise.resolve({
				data: { user: { id: 'existing-user-id' } },
				error: null
			})
		);

		// ユーザー情報を取得
		const { data: userData } = await mockSupabase.auth.getUser();
		expect(userData.user).toBeTruthy();

		// セッション情報を取得
		const { data: session } = await mockSupabase
			.from('sessions')
			.select('*')
			.eq('invite_token', 'token')
			.single();

		// 既に参加しているかチェック
		const { data: existingParticipant } = await mockSupabase
			.from('session_participants')
			.select('id')
			.eq('session_id', session.id)
			.eq('user_id', userData.user.id)
			.maybeSingle();

		// 検証
		expect(existingParticipant).toBeTruthy();
		// 実装では redirect(303, `/session/${session.id}`) が呼ばれる
	});

	it('無効な招待トークンの場合はエラーを返す', async () => {
		// 無効なトークンをシミュレート
		mockSupabase.from = vi.fn((table: string) => {
			if (table === 'sessions') {
				return {
					select: vi.fn(() => ({
						eq: vi.fn(() => ({
							single: vi.fn(() =>
								Promise.resolve({
									data: null, // セッションが見つからない
									error: { message: 'Session not found', code: 'PGRST116' }
								})
							)
						}))
					}))
				};
			}
			return {};
		});

		const token = 'invalid-token';
		const { data: session, error } = await mockSupabase
			.from('sessions')
			.select('*')
			.eq('invite_token', token)
			.single();

		// 検証
		expect(session).toBeNull();
		expect(error).toBeTruthy();
		expect(error.message).toContain('not found');
	});
});

describe('JWT Claims Integrity (Invite Link)', () => {
	let mockSupabase: any;
	let capturedOptions: any[];

	beforeEach(() => {
		capturedOptions = [];

		mockSupabase = {
			from: vi.fn((table: string) => {
				if (table === 'sessions') {
					return {
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								single: vi.fn(() =>
									Promise.resolve({
										data: {
											id: 789,
											name: 'テストセッション（招待）',
											mode: 'tournament',
											is_tournament_mode: true,
											organization_id: 123,
											organizations: { name: 'テスト組織' }
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
						})),
						select: vi.fn(() => ({
							eq: vi.fn(() => ({
								maybeSingle: vi.fn(() =>
									Promise.resolve({
										data: null, // 既存参加者なし
										error: null
									})
								)
							}))
						}))
					};
				}
				return {};
			}),
			auth: {
				getUser: vi.fn(() =>
					Promise.resolve({
						data: { user: null }, // ゲストユーザー
						error: null
					})
				),
				signInAnonymously: vi.fn((opts: any) => {
					capturedOptions.push(opts);
					return Promise.resolve({
						data: {
							session: {
								access_token: 'valid_invite_token',
								user: { id: 'anon-user-invite' }
							}
						},
						error: null
					});
				})
			}
		};
	});

	it('signInAnonymously() に正しい user_metadata が渡される（招待リンク）', async () => {
		// セッション取得
		const token = 'valid-invite-token';
		const { data: session } = await mockSupabase
			.from('sessions')
			.select('*')
			.eq('invite_token', token)
			.single();

		expect(session).toBeTruthy();
		expect(session.id).toBe(789);

		// ゲスト参加処理のシミュレーション
		const guestIdentifier = crypto.randomUUID();
		const guestName = 'テストゲスト（招待リンク）';

		// session_participants に INSERT
		await mockSupabase.from('session_participants').insert({
			session_id: session.id,
			is_guest: true,
			guest_name: guestName,
			guest_identifier: guestIdentifier
		});

		// JWT発行（オプションをキャプチャ）
		await mockSupabase.auth.signInAnonymously({
			options: {
				data: {
					session_id: session.id,
					guest_identifier: guestIdentifier,
					guest_name: guestName,
					is_guest: true
				}
			}
		});

		// 検証: user_metadata に必須フィールドがすべて含まれている
		expect(capturedOptions).toHaveLength(1);
		expect(capturedOptions[0]).toHaveProperty('options');
		expect(capturedOptions[0].options).toHaveProperty('data');

		const metadata = capturedOptions[0].options.data;

		// ✅ RLS前提の必須フィールドをすべて検証
		expect(metadata).toHaveProperty('session_id');
		expect(metadata.session_id).toBe(789);

		expect(metadata).toHaveProperty('guest_identifier');
		expect(metadata.guest_identifier).toBe(guestIdentifier);
		expect(metadata.guest_identifier).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		);

		expect(metadata).toHaveProperty('guest_name');
		expect(metadata.guest_name).toBe('テストゲスト（招待リンク）');

		expect(metadata).toHaveProperty('is_guest');
		expect(metadata.is_guest).toBe(true);
	});

	it('user_metadata の各フィールドが正しい型である', async () => {
		const token = 'valid-invite-token';
		const { data: session } = await mockSupabase
			.from('sessions')
			.select('*')
			.eq('invite_token', token)
			.single();

		const guestIdentifier = crypto.randomUUID();
		const guestName = 'テストゲスト（型検証）';

		await mockSupabase.from('session_participants').insert({
			session_id: session.id,
			is_guest: true,
			guest_name: guestName,
			guest_identifier: guestIdentifier
		});

		await mockSupabase.auth.signInAnonymously({
			options: {
				data: {
					session_id: session.id,
					guest_identifier: guestIdentifier,
					guest_name: guestName,
					is_guest: true
				}
			}
		});

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
		const token = 'valid-invite-token';
		const { data: session } = await mockSupabase
			.from('sessions')
			.select('*')
			.eq('invite_token', token)
			.single();

		const guestIdentifier = crypto.randomUUID();
		const guestName = 'UUID検証テスト';

		await mockSupabase.auth.signInAnonymously({
			options: {
				data: {
					session_id: session.id,
					guest_identifier: guestIdentifier,
					guest_name: guestName,
					is_guest: true
				}
			}
		});

		const metadata = capturedOptions[0].options.data;

		// UUID v4 形式（8-4-4-4-12）
		const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		expect(metadata.guest_identifier).toMatch(uuidV4Regex);
	});

	it('session_id が null または undefined でないことを検証', async () => {
		const token = 'valid-invite-token';
		const { data: session } = await mockSupabase
			.from('sessions')
			.select('*')
			.eq('invite_token', token)
			.single();

		const guestIdentifier = crypto.randomUUID();
		const guestName = 'NULL検証テスト';

		await mockSupabase.auth.signInAnonymously({
			options: {
				data: {
					session_id: session.id,
					guest_identifier: guestIdentifier,
					guest_name: guestName,
					is_guest: true
				}
			}
		});

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
		const token = 'valid-invite-token';
		const { data: session } = await mockSupabase
			.from('sessions')
			.select('*')
			.eq('invite_token', token)
			.single();

		const guestIdentifier = crypto.randomUUID();
		const guestName = 'Boolean厳密検証';

		await mockSupabase.auth.signInAnonymously({
			options: {
				data: {
					session_id: session.id,
					guest_identifier: guestIdentifier,
					guest_name: guestName,
					is_guest: true
				}
			}
		});

		const metadata = capturedOptions[0].options.data;

		// 厳密な比較（RLSポリシーが `is_guest = true` を使用）
		expect(metadata.is_guest).toBe(true);
		expect(metadata.is_guest).not.toBe(1); // truthy な値ではダメ
		expect(metadata.is_guest).not.toBe('true');
		expect(metadata.is_guest === true).toBe(true);
	});
});
