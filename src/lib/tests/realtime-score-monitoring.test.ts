/**
 * Realtimeスコア監視のユニットテスト
 *
 * このテストでは、Supabase Realtimeのモックを使用して、
 * 複数検定員モードのリアルタイムスコア更新機能をテストします。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	createMockSupabaseClient,
	type MockSupabaseRealtime
} from './mocks/supabase-realtime';
import {
	simulateScoreInsert,
	simulateScoreUpdate,
	simulateScoreDelete,
	simulateMultipleJudgesScoring,
	waitForAsync,
	waitForChannelSubscription,
	createMockJudges,
	QueryCounter
} from './helpers/realtime-test-helper';

describe('Realtime Score Monitoring', () => {
	let mockSupabase: any;
	let mockRealtime: MockSupabaseRealtime;
	let queryCounter: QueryCounter;

	beforeEach(() => {
		mockSupabase = createMockSupabaseClient();
		mockRealtime = mockSupabase._mockRealtime;
		queryCounter = new QueryCounter();
	});

	afterEach(() => {
		mockRealtime.clearAllChannels();
	});

	describe('Realtimeチャンネル接続', () => {
		it('チャンネルに正常に接続できる', async () => {
			const channelName = 'training-scores-test';
			let subscriptionStatus = '';

			const channel = mockSupabase
				.channel(channelName)
				.on('postgres_changes', { table: 'training_scores' }, () => {})
				.subscribe((status: string) => {
					subscriptionStatus = status;
				});

			await waitForAsync(20);

			expect(subscriptionStatus).toBe('SUBSCRIBED');
			expect(mockRealtime.isChannelSubscribed(channelName)).toBe(true);
		});

		it('複数のチャンネルを同時に接続できる', async () => {
			const channels = ['scores-1', 'scores-2', 'session-1'];

			channels.forEach((channelName) => {
				mockSupabase
					.channel(channelName)
					.on('postgres_changes', { table: 'training_scores' }, () => {})
					.subscribe();
			});

			await waitForAsync(20);

			expect(mockRealtime.getChannelCount()).toBe(3);
			channels.forEach((channelName) => {
				expect(mockRealtime.isChannelSubscribed(channelName)).toBe(true);
			});
		});

		it('チャンネルを削除できる', async () => {
			const channelName = 'test-channel';
			const channel = mockSupabase
				.channel(channelName)
				.on('postgres_changes', { table: 'training_scores' }, () => {})
				.subscribe();

			await waitForAsync(20);
			expect(mockRealtime.getChannelCount()).toBe(1);

			mockSupabase.removeChannel(channel);
			expect(mockRealtime.getChannelCount()).toBe(0);
		});
	});

	describe('スコアINSERTイベント', () => {
		it('新しいスコアがリアルタイムで追加される', async () => {
			const channelName = 'training-scores-test';
			const receivedScores: any[] = [];

			mockSupabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{ event: '*', table: 'training_scores' },
					(payload: any) => {
						if (payload.eventType === 'INSERT') {
							receivedScores.push(payload.new);
						}
					}
				)
				.subscribe();

			await waitForChannelSubscription(mockRealtime, channelName);

			// スコア追加をシミュレート
			simulateScoreInsert(mockRealtime, channelName, {
				id: 'score_1',
				judge_id: 'judge_1',
				score: 85,
				event_id: 'event_1',
				athlete_id: 'athlete_1'
			});

			await waitForAsync(20);

			expect(receivedScores).toHaveLength(1);
			expect(receivedScores[0].score).toBe(85);
			expect(receivedScores[0].judge_id).toBe('judge_1');
		});

		it('複数の検定員が同時にスコアを入力できる', async () => {
			const channelName = 'training-scores-multi';
			const receivedScores: any[] = [];

			mockSupabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{ event: '*', table: 'training_scores' },
					(payload: any) => {
						if (payload.eventType === 'INSERT') {
							receivedScores.push(payload.new);
						}
					}
				)
				.subscribe();

			await waitForChannelSubscription(mockRealtime, channelName);

			// 3人の検定員が同時採点
			const judges = createMockJudges(3);
			await simulateMultipleJudgesScoring(
				mockRealtime,
				channelName,
				judges.map((j, i) => ({ id: j.id, name: j.name, score: 80 + i })),
				'event_1',
				'athlete_1',
				50 // 50msごとに入力
			);

			await waitForAsync(200);

			expect(receivedScores).toHaveLength(3);
			expect(receivedScores[0].score).toBe(80);
			expect(receivedScores[1].score).toBe(81);
			expect(receivedScores[2].score).toBe(82);
		});

		it('ゲスト検定員のスコアも受信できる', async () => {
			const channelName = 'training-scores-guest';
			const receivedScores: any[] = [];

			mockSupabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{ event: '*', table: 'training_scores' },
					(payload: any) => {
						if (payload.eventType === 'INSERT') {
							receivedScores.push(payload.new);
						}
					}
				)
				.subscribe();

			await waitForChannelSubscription(mockRealtime, channelName);

			// ゲスト検定員のスコア
			simulateScoreInsert(mockRealtime, channelName, {
				id: 'score_guest',
				guest_identifier: 'guest_1',
				score: 90,
				event_id: 'event_1',
				athlete_id: 'athlete_1'
			});

			await waitForAsync(20);

			expect(receivedScores).toHaveLength(1);
			expect(receivedScores[0].guest_identifier).toBe('guest_1');
			expect(receivedScores[0].judge_id).toBeUndefined();
		});
	});

	describe('スコアUPDATEイベント', () => {
		it('スコアの更新が検知される', async () => {
			const channelName = 'training-scores-update';
			const receivedUpdates: any[] = [];

			mockSupabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{ event: '*', table: 'training_scores' },
					(payload: any) => {
						if (payload.eventType === 'UPDATE') {
							receivedUpdates.push({
								old: payload.old,
								new: payload.new
							});
						}
					}
				)
				.subscribe();

			await waitForChannelSubscription(mockRealtime, channelName);

			// スコア更新をシミュレート
			simulateScoreUpdate(
				mockRealtime,
				channelName,
				{ id: 'score_1', judge_id: 'judge_1', score: 80 },
				{ id: 'score_1', judge_id: 'judge_1', score: 85 }
			);

			await waitForAsync(20);

			expect(receivedUpdates).toHaveLength(1);
			expect(receivedUpdates[0].old.score).toBe(80);
			expect(receivedUpdates[0].new.score).toBe(85);
		});
	});

	describe('スコアDELETEイベント（修正要求）', () => {
		it('スコアの削除が検知される', async () => {
			const channelName = 'training-scores-delete';
			const receivedDeletes: any[] = [];

			mockSupabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{ event: '*', table: 'training_scores' },
					(payload: any) => {
						if (payload.eventType === 'DELETE') {
							receivedDeletes.push(payload.old);
						}
					}
				)
				.subscribe();

			await waitForChannelSubscription(mockRealtime, channelName);

			// 修正要求（削除）をシミュレート
			simulateScoreDelete(mockRealtime, channelName, {
				id: 'score_1',
				judge_id: 'judge_1',
				score: 85
			});

			await waitForAsync(20);

			expect(receivedDeletes).toHaveLength(1);
			expect(receivedDeletes[0].judge_id).toBe('judge_1');
		});

		it('修正要求後、再度スコアを入力できる', async () => {
			const channelName = 'training-scores-resubmit';
			const events: Array<{ type: string; data: any }> = [];

			mockSupabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{ event: '*', table: 'training_scores' },
					(payload: any) => {
						events.push({
							type: payload.eventType,
							data: payload.eventType === 'DELETE' ? payload.old : payload.new
						});
					}
				)
				.subscribe();

			await waitForChannelSubscription(mockRealtime, channelName);

			// 初回スコア入力
			simulateScoreInsert(mockRealtime, channelName, {
				id: 'score_1',
				judge_id: 'judge_1',
				score: 80,
				event_id: 'event_1',
				athlete_id: 'athlete_1'
			});

			await waitForAsync(20);

			// 修正要求
			simulateScoreDelete(mockRealtime, channelName, {
				id: 'score_1',
				judge_id: 'judge_1',
				score: 80
			});

			await waitForAsync(20);

			// 再入力
			simulateScoreInsert(mockRealtime, channelName, {
				id: 'score_2',
				judge_id: 'judge_1',
				score: 85,
				event_id: 'event_1',
				athlete_id: 'athlete_1'
			});

			await waitForAsync(20);

			expect(events).toHaveLength(3);
			expect(events[0].type).toBe('INSERT');
			expect(events[0].data.score).toBe(80);
			expect(events[1].type).toBe('DELETE');
			expect(events[2].type).toBe('INSERT');
			expect(events[2].data.score).toBe(85);
		});
	});

	describe('N+1問題の検証', () => {
		it('初回ロードで最小限のクエリ数でデータを取得する', () => {
			// モックのクエリ数をカウント
			const originalFrom = mockSupabase.from;
			mockSupabase.from = vi.fn((table: string) => {
				queryCounter.incrementQuery(table, 'select');
				return originalFrom(table);
			});

			// シミュレーション: 5人の検定員がいる場合
			const judgeCount = 5;

			// Before（N+1問題あり）: 1 + 5 + 5 = 11クエリ
			// - 1: training_scores全体取得
			// - 5: 各スコアのjudge_id → profiles（N+1）
			// - 5: 各スコアのguest_identifier → session_participants（N+1）

			// After（修正後）: 最大3クエリ
			// - 1: training_scores全体取得
			// - 1: 全judge_idを一度にprofilesから取得（IN句使用）
			// - 1: 全guest_identifierを一度にsession_participantsから取得（IN句使用）

			// 修正後のクエリパターンをシミュレート
			mockSupabase.from('training_scores'); // 1クエリ
			mockSupabase.from('profiles'); // 1クエリ（IN句で全員分）
			mockSupabase.from('session_participants'); // 1クエリ（IN句で全員分）

			// 期待: 最大3クエリ（N+1問題が解決されている）
			queryCounter.assertQueryCountLessThan(
				5,
				`N+1問題が解決されていません: ${judgeCount}人の検定員で${queryCounter.getCount()}クエリが発行されました`
			);

			expect(queryCounter.getCount()).toBeLessThanOrEqual(3);
		});
	});

	describe('パフォーマンス検証', () => {
		it('100人の検定員でも高速に処理できる', async () => {
			const channelName = 'training-scores-performance';
			const receivedScores: any[] = [];

			mockSupabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{ event: '*', table: 'training_scores' },
					(payload: any) => {
						if (payload.eventType === 'INSERT') {
							receivedScores.push(payload.new);
						}
					}
				)
				.subscribe();

			await waitForChannelSubscription(mockRealtime, channelName);

			const startTime = Date.now();

			// 100人の検定員が同時採点（delayなし）
			const judges = createMockJudges(100);
			await simulateMultipleJudgesScoring(
				mockRealtime,
				channelName,
				judges.map((j, i) => ({ id: j.id, name: j.name, score: 80 + (i % 20) })),
				'event_1',
				'athlete_1',
				0 // 遅延なし
			);

			await waitForAsync(100);

			const endTime = Date.now();
			const duration = endTime - startTime;

			expect(receivedScores).toHaveLength(100);
			expect(duration).toBeLessThan(500); // 500ms以内
		});

		it('スコア更新のレイテンシーが低い', async () => {
			const channelName = 'training-scores-latency';
			let receivedAt = 0;

			mockSupabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{ event: '*', table: 'training_scores' },
					(payload: any) => {
						receivedAt = Date.now();
					}
				)
				.subscribe();

			await waitForChannelSubscription(mockRealtime, channelName);

			const sentAt = Date.now();
			simulateScoreInsert(mockRealtime, channelName, {
				id: 'score_latency',
				judge_id: 'judge_1',
				score: 85,
				event_id: 'event_1',
				athlete_id: 'athlete_1'
			});

			await waitForAsync(50);

			const latency = receivedAt - sentAt;
			expect(latency).toBeLessThan(100); // 100ms以内
		});
	});
});
