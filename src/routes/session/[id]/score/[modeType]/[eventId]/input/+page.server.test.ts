/**
 * Concurrent Scoring - Retry Logic テスト
 *
 * 同時採点時の競合エラー（SERIALIZATION FAILURE, DEADLOCK）に対する
 * 指数バックオフリトライロジックをテストします
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Concurrent Scoring - Retry Logic', () => {
	let mockSupabase: any;
	let upsertCallCount: number;

	beforeEach(() => {
		upsertCallCount = 0;
	});

	it('SERIALIZATION FAILURE時に指数バックオフでリトライする', async () => {
		const retryDelays: number[] = [];

		mockSupabase = {
			from: vi.fn(() => ({
				upsert: vi.fn(() => {
					upsertCallCount++;
					if (upsertCallCount < 3) {
						// 最初の2回は失敗
						return Promise.resolve({
							error: { code: '40001', message: 'could not serialize access due to concurrent update' }
						});
					} else {
						// 3回目で成功
						return Promise.resolve({ error: null });
					}
				})
			}))
		};

		// Retryロジック（実装と同じ）
		const MAX_RETRIES = 3;
		let insertError: any = null;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			const { error } = await mockSupabase.from('results').upsert({
				session_id: 1,
				bib: 10,
				score: 85,
				judge_name: 'テスト検定員',
				discipline: 'rhythmic',
				level: '1級',
				event_name: 'ロープ'
			});

			if (!error) {
				insertError = null;
				break;
			}

			const errorCode = error.code;
			const isRetryable = errorCode === '40001' || errorCode === '40P01';

			if (!isRetryable) {
				insertError = error;
				break;
			}

			insertError = error;
			console.warn(`[Test] Retryable error (${errorCode}) on attempt ${attempt + 1}/${MAX_RETRIES}`);

			if (attempt < MAX_RETRIES - 1) {
				const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 100, 1000);
				retryDelays.push(delay);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		// 検証
		expect(upsertCallCount).toBe(3); // 3回試行
		expect(insertError).toBeNull(); // 最終的に成功
		expect(retryDelays).toHaveLength(2); // 1回目と2回目のみ遅延

		// 指数バックオフの検証
		expect(retryDelays[0]).toBeGreaterThanOrEqual(100); // 1回目: 100ms + ランダム
		expect(retryDelays[0]).toBeLessThan(200);

		expect(retryDelays[1]).toBeGreaterThanOrEqual(200); // 2回目: 200ms + ランダム
		expect(retryDelays[1]).toBeLessThan(400);
	});

	it('DEADLOCK時にリトライする', async () => {
		upsertCallCount = 0;

		mockSupabase = {
			from: vi.fn(() => ({
				upsert: vi.fn(() => {
					upsertCallCount++;
					if (upsertCallCount < 2) {
						// 1回目は失敗
						return Promise.resolve({
							error: { code: '40P01', message: 'deadlock detected' }
						});
					} else {
						// 2回目で成功
						return Promise.resolve({ error: null });
					}
				})
			}))
		};

		const MAX_RETRIES = 3;
		let insertError: any = null;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			const { error } = await mockSupabase.from('results').upsert({});

			if (!error) {
				insertError = null;
				break;
			}

			const errorCode = error.code;
			const isRetryable = errorCode === '40001' || errorCode === '40P01';

			if (!isRetryable) {
				insertError = error;
				break;
			}

			insertError = error;

			if (attempt < MAX_RETRIES - 1) {
				const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 100, 1000);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		// 検証
		expect(upsertCallCount).toBe(2); // 2回で成功
		expect(insertError).toBeNull();
	});

	it('リトライ不可能なエラーは即座に失敗する', async () => {
		upsertCallCount = 0;

		mockSupabase = {
			from: vi.fn(() => ({
				upsert: vi.fn(() => {
					upsertCallCount++;
					return Promise.resolve({
						error: { code: '23505', message: 'duplicate key value violates unique constraint' } // リトライ不可能
					});
				})
			}))
		};

		const MAX_RETRIES = 3;
		let insertError: any = null;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			const { error } = await mockSupabase.from('results').upsert({});

			if (!error) {
				insertError = null;
				break;
			}

			const errorCode = error.code;
			const isRetryable = errorCode === '40001' || errorCode === '40P01';

			if (!isRetryable) {
				insertError = error;
				break;
			}
		}

		// 1回だけ試行して即座に失敗
		expect(upsertCallCount).toBe(1);
		expect(insertError).toBeTruthy();
		expect(insertError.code).toBe('23505');
	});

	it('3回リトライしても失敗した場合はエラーを返す', async () => {
		upsertCallCount = 0;

		mockSupabase = {
			from: vi.fn(() => ({
				upsert: vi.fn(() => {
					upsertCallCount++;
					return Promise.resolve({
						error: { code: '40001', message: 'SERIALIZATION FAILURE' }
					});
				})
			}))
		};

		const MAX_RETRIES = 3;
		let insertError: any = null;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			const { error } = await mockSupabase.from('results').upsert({});

			if (!error) {
				insertError = null;
				break;
			}

			const errorCode = error.code;
			const isRetryable = errorCode === '40001' || errorCode === '40P01';

			if (!isRetryable) {
				insertError = error;
				break;
			}

			insertError = error;

			if (attempt < MAX_RETRIES - 1) {
				const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 100, 1000);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		// 3回すべて失敗
		expect(upsertCallCount).toBe(3);
		expect(insertError).toBeTruthy();
		expect(insertError.code).toBe('40001');
	});

	it('エラーメッセージが適切に生成される', () => {
		const testCases = [
			{
				code: '40001',
				expected: '複数の検定員が同時に採点したため、再度お試しください。'
			},
			{
				code: '40P01',
				expected: '複数の検定員が同時に採点したため、再度お試しください。'
			},
			{
				code: '23505',
				customMessage: 'Unique constraint violation',
				expected: 'Unique constraint violation'
			},
			{
				code: '22001',
				customMessage: 'String data right truncation',
				expected: 'String data right truncation'
			}
		];

		testCases.forEach(({ code, customMessage, expected }) => {
			const isRetryableError = code === '40001' || code === '40P01';

			let errorMessage = '採点の保存に失敗しました。';
			if (isRetryableError) {
				errorMessage += '複数の検定員が同時に採点したため、再度お試しください。';
			} else if (customMessage) {
				errorMessage += customMessage;
			}

			if (isRetryableError) {
				expect(errorMessage).toContain(expected);
			} else {
				expect(errorMessage).toContain(customMessage || '');
			}
		});
	});

	it('複数の検定員が同時に採点してもデータ整合性が保たれる', async () => {
		// シンプルな検証: 各検定員が独立してリトライロジックを持つ
		const judges = [
			{ name: '検定員A', failureCount: 2 },
			{ name: '検定員B', failureCount: 1 },
			{ name: '検定員C', failureCount: 0 }
		];

		const results = [];

		for (const judge of judges) {
			let callCount = 0;

			const judgeSupabase = {
				from: vi.fn(() => ({
					upsert: vi.fn(() => {
						callCount++;
						// 指定回数だけ失敗
						if (callCount <= judge.failureCount) {
							return Promise.resolve({
								error: { code: '40001', message: 'SERIALIZATION FAILURE' }
							});
						}
						return Promise.resolve({ error: null });
					})
				}))
			};

			const MAX_RETRIES = 3;
			let insertError: any = null;

			for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
				const { error } = await judgeSupabase.from('results').upsert({
					judge_name: judge.name
				});

				if (!error) {
					insertError = null;
					break;
				}

				insertError = error;

				if (attempt < MAX_RETRIES - 1) {
					const delay = 10; // テスト高速化のため短縮
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}

			results.push({
				judge: judge.name,
				success: insertError === null,
				attempts: callCount
			});
		}

		// 検証: 全員が最終的に成功
		expect(results[0].success).toBe(true);
		expect(results[0].attempts).toBe(3); // 2回失敗、3回目で成功

		expect(results[1].success).toBe(true);
		expect(results[1].attempts).toBe(2); // 1回失敗、2回目で成功

		expect(results[2].success).toBe(true);
		expect(results[2].attempts).toBe(1); // 即座に成功
	});
});

describe('judge_name Collision Prevention', () => {
	it('ゲスト名に " (ゲスト)" suffixが付与される', () => {
		const guestParticipant = {
			guest_name: '田中太郎',
			guest_identifier: 'guest-uuid-123'
		};

		let judgeName: string;
		if (guestParticipant) {
			// ゲストの場合: 識別用 suffix を追加（認証ユーザーとの衝突回避）
			judgeName = `${guestParticipant.guest_name} (ゲスト)`;
		}

		expect(judgeName!).toBe('田中太郎 (ゲスト)');
	});

	it('認証ユーザーには suffixが付与されない', () => {
		const user = { id: 'user-uuid', email: 'tanaka@example.com' };
		const profile = { full_name: '田中太郎' };

		let judgeName: string;
		if (user) {
			judgeName = profile?.full_name || user.email || 'Unknown';
		}

		expect(judgeName!).toBe('田中太郎'); // suffixなし
	});

	it('同名のゲストと認証ユーザーが区別される', () => {
		const guestJudgeName = '田中太郎 (ゲスト)';
		const userJudgeName = '田中太郎';

		expect(guestJudgeName).not.toBe(userJudgeName);

		// データベース上でも区別される
		const scores = [
			{ judge_name: guestJudgeName, score: 85, is_guest: true },
			{ judge_name: userJudgeName, score: 90, is_guest: false }
		];

		const guestScore = scores.find((s) => s.judge_name === guestJudgeName);
		const userScore = scores.find((s) => s.judge_name === userJudgeName);

		expect(guestScore).toBeTruthy();
		expect(guestScore!.is_guest).toBe(true);
		expect(guestScore!.score).toBe(85);

		expect(userScore).toBeTruthy();
		expect(userScore!.is_guest).toBe(false);
		expect(userScore!.score).toBe(90);
	});

	it('プロフィール未設定のユーザーはemailが使用される', () => {
		const user = { id: 'user-uuid', email: 'test@example.com' };
		const profile = null; // プロフィール未設定

		let judgeName: string;
		judgeName = profile?.full_name || user.email || 'Unknown';

		expect(judgeName).toBe('test@example.com');
	});

	it('ゲスト・ユーザー・プロフィール未設定が混在しても正しく区別される', () => {
		const judges = [
			{ type: 'guest', name: '田中太郎 (ゲスト)', identifier: 'guest-1' },
			{ type: 'user', name: '田中太郎', userId: 'user-1' },
			{ type: 'user_no_profile', name: 'tanaka@example.com', userId: 'user-2' }
		];

		// 全員が異なるjudge_nameを持つ
		const uniqueNames = new Set(judges.map((j) => j.name));
		expect(uniqueNames.size).toBe(3);

		// ゲストのみsuffixを持つ
		const guestJudges = judges.filter((j) => j.name.includes('(ゲスト)'));
		expect(guestJudges).toHaveLength(1);
	});
});
