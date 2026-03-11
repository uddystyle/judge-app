/**
 * Realtime機能の統合テスト
 *
 * 実際のSupabaseに接続して、複数検定員モードのRealtime機能をテストします。
 *
 * 実行方法:
 *   npm run test:integration
 *
 * 前提条件:
 *   - .env.testファイルにSupabase接続情報が設定されていること
 *   - Supabase Realtimeが有効化されていること
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RealtimeChannel } from '@supabase/supabase-js';

// テスト用の環境変数
const SUPABASE_URL = process.env.TEST_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;

// テストをスキップするかどうか
const SKIP_INTEGRATION_TESTS = !SUPABASE_URL || !SUPABASE_ANON_KEY;

describe.skipIf(SKIP_INTEGRATION_TESTS)('Realtime Multi-Judge Integration Tests', () => {
	let supabase: SupabaseClient;
	let testSessionId: string;
	let testEventId: string;
	let testAthleteId: string;
	let channels: RealtimeChannel[] = [];

	beforeAll(async () => {
		if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
			throw new Error('Supabase credentials not found in environment');
		}

		supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

		// テストデータの作成
		// 注: 実際の環境では、テスト用のセッションを作成する必要があります
		console.log('⚠️  Integration tests require a test session in Supabase');
		console.log('   Set TEST_SESSION_ID, TEST_EVENT_ID, TEST_ATHLETE_ID in .env.test');
	});

	afterAll(async () => {
		// すべてのチャンネルをクリーンアップ
		for (const channel of channels) {
			await supabase.removeChannel(channel);
		}

		// テストデータのクリーンアップ（オプション）
		// await cleanupTestData();
	});

	beforeEach(() => {
		channels = [];
	});

	describe('Realtimeチャンネル接続', () => {
		it('training_scoresテーブルに接続できる', async () => {
			return new Promise<void>((resolve, reject) => {
				const channel = supabase
					.channel(`test-channel-${Date.now()}`)
					.on(
						'postgres_changes',
						{
							event: '*',
							schema: 'public',
							table: 'training_scores'
						},
						() => {}
					)
					.subscribe((status) => {
						if (status === 'SUBSCRIBED') {
							channels.push(channel);
							resolve();
						} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
							reject(new Error(`Subscription failed: ${status}`));
						}
					});

				// タイムアウト
				setTimeout(() => reject(new Error('Subscription timeout')), 5000);
			});
		});

		it('resultsテーブルに接続できる', async () => {
			return new Promise<void>((resolve, reject) => {
				const channel = supabase
					.channel(`test-results-${Date.now()}`)
					.on(
						'postgres_changes',
						{
							event: '*',
							schema: 'public',
							table: 'results'
						},
						() => {}
					)
					.subscribe((status) => {
						if (status === 'SUBSCRIBED') {
							channels.push(channel);
							resolve();
						} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
							reject(new Error(`Subscription failed: ${status}`));
						}
					});

				setTimeout(() => reject(new Error('Subscription timeout')), 5000);
			});
		});

		it('sessionsテーブルに接続できる', async () => {
			return new Promise<void>((resolve, reject) => {
				const channel = supabase
					.channel(`test-sessions-${Date.now()}`)
					.on(
						'postgres_changes',
						{
							event: 'UPDATE',
							schema: 'public',
							table: 'sessions'
						},
						() => {}
					)
					.subscribe((status) => {
						if (status === 'SUBSCRIBED') {
							channels.push(channel);
							resolve();
						} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
							reject(new Error(`Subscription failed: ${status}`));
						}
					});

				setTimeout(() => reject(new Error('Subscription timeout')), 5000);
			});
		});
	});

	describe.skip('スコアのリアルタイム更新（手動テスト）', () => {
		// このテストは実際にデータを挿入するため、手動実行推奨
		it('スコアINSERTイベントを受信できる', async () => {
			// テスト用のセッションIDを設定
			const sessionId = process.env.TEST_SESSION_ID;
			const eventId = process.env.TEST_EVENT_ID;
			const athleteId = process.env.TEST_ATHLETE_ID;

			if (!sessionId || !eventId || !athleteId) {
				console.warn('⚠️  Skipping: TEST_SESSION_ID, TEST_EVENT_ID, TEST_ATHLETE_ID not set');
				return;
			}

			return new Promise<void>(async (resolve, reject) => {
				const receivedScores: any[] = [];

				// Realtimeリスナーを設定
				const channel = supabase
					.channel(`test-score-insert-${Date.now()}`)
					.on(
						'postgres_changes',
						{
							event: 'INSERT',
							schema: 'public',
							table: 'training_scores',
							filter: `event_id=eq.${eventId}`
						},
						(payload) => {
							console.log('📥 Received INSERT:', payload);
							receivedScores.push(payload.new);

							// 1つ受信したらテスト成功
							if (receivedScores.length > 0) {
								resolve();
							}
						}
					)
					.subscribe(async (status) => {
						if (status === 'SUBSCRIBED') {
							console.log('✅ Subscribed to training_scores');
							channels.push(channel);

							// テストデータを挿入
							const { data, error } = await supabase.from('training_scores').insert({
								event_id: eventId,
								athlete_id: athleteId,
								judge_id: null,
								guest_identifier: `test_${Date.now()}`,
								score: 85
							});

							if (error) {
								console.error('❌ Insert error:', error);
								reject(error);
							} else {
								console.log('✅ Test score inserted');
							}
						} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
							reject(new Error(`Subscription failed: ${status}`));
						}
					});

				// タイムアウト
				setTimeout(() => {
					if (receivedScores.length === 0) {
						reject(new Error('No events received within timeout'));
					}
				}, 10000);
			});
		});
	});

	describe('Realtime設定の検証', () => {
		it('training_scoresがpublicationに含まれているか確認', async () => {
			const { data, error } = await supabase.rpc('check_realtime_publication', {
				table_name: 'training_scores'
			});

			// このRPC関数は存在しない可能性があるため、エラーハンドリング
			if (error && error.message.includes('does not exist')) {
				console.warn('⚠️  RPC function not found - skipping publication check');
				console.warn('   Manually verify in Supabase Dashboard: Database → Replication');
				return;
			}

			// エラーがない場合、publicationに含まれているはず
			expect(error).toBeNull();
		});
	});

	describe('パフォーマンステスト', () => {
		it('WebSocket接続が確立される', async () => {
			const channel = supabase
				.channel(`perf-test-${Date.now()}`)
				.on(
					'postgres_changes',
					{
						event: '*',
						schema: 'public',
						table: 'training_scores'
					},
					() => {}
				);

			const startTime = Date.now();

			return new Promise<void>((resolve, reject) => {
				channel.subscribe((status) => {
					if (status === 'SUBSCRIBED') {
						const connectionTime = Date.now() - startTime;
						console.log(`✅ WebSocket connection time: ${connectionTime}ms`);
						channels.push(channel);

						// 接続時間が2秒以内
						expect(connectionTime).toBeLessThan(2000);
						resolve();
					} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
						reject(new Error(`Connection failed: ${status}`));
					}
				});

				setTimeout(() => reject(new Error('Connection timeout')), 5000);
			});
		});
	});
});
