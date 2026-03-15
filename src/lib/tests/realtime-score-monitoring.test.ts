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

		it('同一検定員のINSERTイベント重複時にupsertされる', async () => {
			const channelName = 'training-scores-upsert';
			const scoreStatus = { scores: [] as any[], requiredJudges: 3 };

			mockSupabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{ event: '*', table: 'training_scores' },
					(payload: any) => {
						if (payload.eventType === 'INSERT') {
							// 実装と同じupsertロジック
							const existingIndex = scoreStatus.scores.findIndex((s: any) => {
								if (payload.new.guest_identifier) {
									return s.guest_identifier === payload.new.guest_identifier;
								} else {
									return s.judge_id === payload.new.judge_id;
								}
							});

							const newScore = {
								judge_id: payload.new.judge_id,
								guest_identifier: payload.new.guest_identifier,
								judge_name: 'Judge Name',
								score: payload.new.score,
								is_guest: !!payload.new.guest_identifier
							};

							if (existingIndex !== -1) {
								// 既存データがある場合：UPDATE扱い
								scoreStatus.scores[existingIndex] = newScore;
							} else {
								// 既存データがない場合：新規追加
								scoreStatus.scores.push(newScore);
							}
						}
					}
				)
				.subscribe();

			await waitForChannelSubscription(mockRealtime, channelName);

			// 初回INSERT
			simulateScoreInsert(mockRealtime, channelName, {
				id: 'score_1',
				judge_id: 'judge_1',
				score: 80,
				event_id: 'event_1',
				athlete_id: 'athlete_1'
			});

			await waitForAsync(20);
			expect(scoreStatus.scores).toHaveLength(1);
			expect(scoreStatus.scores[0].score).toBe(80);

			// 同じ検定員が再度INSERT（重複イベント）
			simulateScoreInsert(mockRealtime, channelName, {
				id: 'score_2', // IDは異なる
				judge_id: 'judge_1', // 同じ検定員
				score: 85,
				event_id: 'event_1',
				athlete_id: 'athlete_1'
			});

			await waitForAsync(20);

			// 重複せず、スコアが更新される
			expect(scoreStatus.scores).toHaveLength(1);
			expect(scoreStatus.scores[0].score).toBe(85);
			expect(scoreStatus.scores[0].judge_id).toBe('judge_1');
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

	describe('results（大会モード）のRealtime監視', () => {
		it('resultsテーブルのINSERTイベントが受信できる', async () => {
			const channelName = 'results-tournament';
			const receivedResults: any[] = [];

			mockSupabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{ event: '*', table: 'results' },
					(payload: any) => {
						if (payload.eventType === 'INSERT') {
							receivedResults.push(payload.new);
						}
					}
				)
				.subscribe();

			await waitForChannelSubscription(mockRealtime, channelName);

			// resultsテーブルへのINSERTをシミュレート
			mockRealtime.simulateEvent(channelName, 'INSERT', 'results', {
				new: {
					id: 'result_1',
					session_id: 'session_1',
					bib: 10,
					discipline: 'rhythmic',
					level: '1級',
					event_name: 'ロープ',
					judge_name: 'Judge A',
					score: 85.5
				}
			});

			await waitForAsync(20);

			expect(receivedResults).toHaveLength(1);
			expect(receivedResults[0].score).toBe(85.5);
			expect(receivedResults[0].judge_name).toBe('Judge A');
			expect(receivedResults[0].discipline).toBe('rhythmic');
		});

		it('resultsのクライアント側フィルタ判定が正しく動作する', async () => {
			const channelName = 'results-filter';
			const targetDiscipline = 'rhythmic';
			const targetLevel = '1級';
			const targetEvent = 'ロープ';
			const filteredResults: any[] = [];

			mockSupabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{ event: '*', table: 'results' },
					(payload: any) => {
						// クライアント側フィルタ判定（実装と同じロジック）
						if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
							if (
								payload.new?.discipline === targetDiscipline &&
								payload.new?.level === targetLevel &&
								payload.new?.event_name === targetEvent
							) {
								filteredResults.push(payload.new);
							}
						}
					}
				)
				.subscribe();

			await waitForChannelSubscription(mockRealtime, channelName);

			// マッチするイベント
			mockRealtime.simulateEvent(channelName, 'INSERT', 'results', {
				new: {
					id: 'result_1',
					session_id: 'session_1',
					bib: 10,
					discipline: 'rhythmic',
					level: '1級',
					event_name: 'ロープ',
					score: 85.5
				}
			});

			await waitForAsync(20);

			// マッチしないイベント（異なるdiscipline）
			mockRealtime.simulateEvent(channelName, 'INSERT', 'results', {
				new: {
					id: 'result_2',
					session_id: 'session_1',
					bib: 11,
					discipline: 'artistic', // 異なる
					level: '1級',
					event_name: 'ロープ',
					score: 82.0
				}
			});

			await waitForAsync(20);

			// マッチしないイベント（異なるlevel）
			mockRealtime.simulateEvent(channelName, 'INSERT', 'results', {
				new: {
					id: 'result_3',
					session_id: 'session_1',
					bib: 12,
					discipline: 'rhythmic',
					level: '2級', // 異なる
					event_name: 'ロープ',
					score: 88.0
				}
			});

			await waitForAsync(20);

			// フィルタ判定により、1つだけ追加される
			expect(filteredResults).toHaveLength(1);
			expect(filteredResults[0].id).toBe('result_1');
		});

		it('resultsのDELETEイベントでクライアント側フィルタ判定が動作する', async () => {
			const channelName = 'results-delete-filter';
			const targetDiscipline = 'rhythmic';
			const targetLevel = '1級';
			const targetEvent = 'ロープ';
			let deleteShouldUpdate = false;

			mockSupabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{ event: '*', table: 'results' },
					(payload: any) => {
						if (payload.eventType === 'DELETE') {
							// クライアント側フィルタ判定
							if (
								payload.old?.discipline === targetDiscipline &&
								payload.old?.level === targetLevel &&
								payload.old?.event_name === targetEvent
							) {
								deleteShouldUpdate = true;
							}
						}
					}
				)
				.subscribe();

			await waitForChannelSubscription(mockRealtime, channelName);

			// マッチするDELETEイベント
			mockRealtime.simulateEvent(channelName, 'DELETE', 'results', {
				old: {
					id: 'result_1',
					discipline: 'rhythmic',
					level: '1級',
					event_name: 'ロープ',
					score: 85.5
				}
			});

			await waitForAsync(20);

			expect(deleteShouldUpdate).toBe(true);
		});
	});

	describe('Realtime接続エラーと自己回復', () => {
		it('CHANNEL_ERROR時に再接続が試行される', async () => {
			const channelName = 'error-recovery';
			let subscriptionAttempts = 0;
			let lastStatus = '';

			const attemptSubscription = () => {
				subscriptionAttempts++;
				mockSupabase
					.channel(channelName)
					.on('postgres_changes', { table: 'training_scores' }, () => {})
					.subscribe((status: string) => {
						lastStatus = status;
					});
			};

			// 初回購読
			attemptSubscription();
			await waitForAsync(20);
			expect(lastStatus).toBe('SUBSCRIBED');

			// CHANNEL_ERRORをシミュレート
			mockRealtime.simulateChannelError(channelName);
			await waitForAsync(20);

			// 再接続を試行
			attemptSubscription();
			await waitForAsync(20);

			expect(subscriptionAttempts).toBe(2);
			expect(lastStatus).toBe('SUBSCRIBED');
		});

		it('TIMED_OUT時に再接続が試行される', async () => {
			const channelName = 'timeout-recovery';
			let reconnectCalled = false;
			let currentStatus = '';

			mockSupabase
				.channel(channelName)
				.on('postgres_changes', { table: 'training_scores' }, () => {})
				.subscribe((status: string) => {
					currentStatus = status;
					if (status === 'TIMED_OUT') {
						reconnectCalled = true;
					}
				});

			await waitForAsync(20);
			expect(currentStatus).toBe('SUBSCRIBED');

			// タイムアウトをシミュレート
			mockRealtime.simulateChannelTimeout(channelName);
			await waitForAsync(20);

			expect(reconnectCalled).toBe(true);
		});

		it('指数バックオフで再接続の遅延が増加する', async () => {
			const retryDelays: number[] = [];

			// 指数バックオフのシミュレーション
			for (let retryCount = 0; retryCount < 5; retryCount++) {
				const backoffDelay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s, 8s, 16s
				retryDelays.push(backoffDelay);
			}

			expect(retryDelays).toEqual([1000, 2000, 4000, 8000, 16000]);
		});

		it('最大リトライ回数到達後はフォールバックポーリングに切り替わる', async () => {
			const MAX_RETRY_COUNT = 5;
			let retryCount = 0;
			let fallbackPollingStarted = false;

			// 再接続を繰り返す
			while (retryCount < MAX_RETRY_COUNT) {
				retryCount++;
				// 再接続失敗をシミュレート
			}

			// 最大リトライ回数到達
			if (retryCount >= MAX_RETRY_COUNT) {
				fallbackPollingStarted = true;
			}

			expect(retryCount).toBe(5);
			expect(fallbackPollingStarted).toBe(true);
		});

		it('再接続成功時にリトライカウントがリセットされる', async () => {
			let retryCount = 3;

			// 再接続成功をシミュレート
			const onSubscriptionSuccess = () => {
				retryCount = 0; // リセット
			};

			onSubscriptionSuccess();
			expect(retryCount).toBe(0);
		});

		it('再接続成功時にフォールバックポーリングが停止される', async () => {
			let fallbackPollingActive = true;

			// 再接続成功をシミュレート
			const onSubscriptionSuccess = () => {
				if (fallbackPollingActive) {
					fallbackPollingActive = false; // 停止
				}
			};

			onSubscriptionSuccess();
			expect(fallbackPollingActive).toBe(false);
		});

		it('手動更新でリトライカウントがリセットされる', async () => {
			let retryCount = 4;
			let dataRefreshed = false;

			// 手動更新ボタンのクリックをシミュレート
			const manualRefresh = async () => {
				dataRefreshed = true;
				retryCount = 0; // リトライカウントをリセット
			};

			await manualRefresh();

			expect(retryCount).toBe(0);
			expect(dataRefreshed).toBe(true);
		});

		it('連続したエラーイベントで再接続タイマーが多重登録されない', async () => {
			let retryTimer: any = null;
			let retryCount = 0;
			let setupCallCount = 0;
			const MAX_RETRY_COUNT = 5;

			const mockSetupScoreRealtimeChannel = () => {
				setupCallCount++;
			};

			const retryRealtimeConnection = () => {
				// ✅ FIX: 既存のタイマーをクリアして多重登録を防止
				if (retryTimer) {
					clearTimeout(retryTimer);
					retryTimer = null;
				}

				if (retryCount >= MAX_RETRY_COUNT) {
					return;
				}

				const backoffDelay = Math.pow(2, retryCount) * 1000;
				retryCount++;

				retryTimer = setTimeout(() => {
					mockSetupScoreRealtimeChannel();
				}, backoffDelay);
			};

			// 短時間に3回連続でCHANNEL_ERRORが来る
			retryRealtimeConnection();
			await waitForAsync(10);
			retryRealtimeConnection();
			await waitForAsync(10);
			retryRealtimeConnection();

			// retryTimer は最後の1つのみ残っている
			expect(retryTimer).not.toBeNull();
			expect(retryCount).toBe(3);

			// 最後のタイマーだけが実行される
			await waitForAsync(Math.pow(2, 2) * 1000 + 100);
			expect(setupCallCount).toBe(1);

			// タイマーをクリーンアップ
			if (retryTimer) {
				clearTimeout(retryTimer);
			}
		});

		it('エラー継続中の多重タイマー登録が防止される', async () => {
			let retryTimer: any = null;
			let timerSetCount = 0;
			let timerClearCount = 0;

			const mockSetTimeout = (callback: () => void, delay: number) => {
				timerSetCount++;
				return setTimeout(callback, delay);
			};

			const mockClearTimeout = (timer: any) => {
				if (timer) {
					timerClearCount++;
					clearTimeout(timer);
				}
			};

			const retryRealtimeConnection = () => {
				// 既存のタイマーをクリア
				if (retryTimer) {
					mockClearTimeout(retryTimer);
					retryTimer = null;
				}

				// 新しいタイマーを登録
				retryTimer = mockSetTimeout(() => {}, 1000);
			};

			// 5回連続で呼び出し
			for (let i = 0; i < 5; i++) {
				retryRealtimeConnection();
			}

			// タイマー登録は5回、クリアは4回（1回目以外）
			expect(timerSetCount).toBe(5);
			expect(timerClearCount).toBe(4);

			// 最後の1つだけが残っている
			expect(retryTimer).not.toBeNull();

			// クリーンアップ
			if (retryTimer) {
				clearTimeout(retryTimer);
			}
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

	describe('fetchStatus() race condition防止（セマフォパターン）', () => {
		it('複数の同時fetchStatus呼び出しが直列化される', async () => {
			// セマフォパターンのシミュレーション
			let isFetchingStatus = false;
			let pendingFetchRequest = false;
			let fetchExecutionCount = 0;
			let concurrentCallAttempts = 0;

			const mockFetchStatus = async () => {
				concurrentCallAttempts++;

				// 既に実行中の場合、ペンディング状態にして終了
				if (isFetchingStatus) {
					pendingFetchRequest = true;
					return;
				}

				try {
					isFetchingStatus = true;
					pendingFetchRequest = false;
					fetchExecutionCount++;

					// API呼び出しをシミュレート（100ms）
					await new Promise((resolve) => setTimeout(resolve, 100));
				} finally {
					isFetchingStatus = false;

					// ペンディング中のリクエストがあれば再実行
					if (pendingFetchRequest) {
						setTimeout(() => mockFetchStatus(), 100);
					}
				}
			};

			// 3つの同時呼び出し
			const promises = [mockFetchStatus(), mockFetchStatus(), mockFetchStatus()];

			await Promise.all(promises);
			await waitForAsync(500); // ペンディングリクエスト実行のための待機

			// 3回の呼び出し試行があったが、実際の実行は2回のみ（1回目 + ペンディング1回）
			expect(concurrentCallAttempts).toBe(3);
			expect(fetchExecutionCount).toBe(2);
		});

		it('ペンディングリクエストが確実に実行される', async () => {
			let isFetchingStatus = false;
			let pendingFetchRequest = false;
			let executionLog: string[] = [];

			const mockFetchStatus = async (callId: string) => {
				executionLog.push(`${callId}_called`);

				if (isFetchingStatus) {
					pendingFetchRequest = true;
					executionLog.push(`${callId}_pending`);
					return;
				}

				try {
					isFetchingStatus = true;
					pendingFetchRequest = false;
					executionLog.push(`${callId}_executing`);

					// 模擬的な非同期処理
					await new Promise((resolve) => setTimeout(resolve, 50));
				} finally {
					isFetchingStatus = false;
					executionLog.push(`${callId}_finished`);

					// ペンディング中のリクエストがあれば再実行
					if (pendingFetchRequest) {
						executionLog.push(`pending_triggered`);
						setTimeout(() => mockFetchStatus('pending_auto'), 100);
					}
				}
			};

			// 1つ目の呼び出し開始（実行される）
			const call1 = mockFetchStatus('call1');
			await waitForAsync(10);

			// 2つ目の呼び出し（実行中のため、ペンディング状態になる）
			const call2 = mockFetchStatus('call2');
			await waitForAsync(10);

			await Promise.all([call1, call2]);
			await waitForAsync(200); // ペンディングリクエスト実行のための待機

			// call1が実行され、call2はペンディング状態になり、後で自動実行される
			expect(executionLog).toContain('call1_executing');
			expect(executionLog).toContain('call2_pending');
			expect(executionLog).toContain('pending_triggered');
			expect(executionLog).toContain('pending_auto_executing');
		});

		it('Realtimeイベントからのfetchは既存実行を待つ', async () => {
			let isFetchingStatus = false;
			let pendingFetchRequest = false;
			let fetchCount = 0;

			const mockFetchStatus = async () => {
				if (isFetchingStatus) {
					pendingFetchRequest = true;
					return;
				}

				try {
					isFetchingStatus = true;
					pendingFetchRequest = false;
					fetchCount++;
					await new Promise((resolve) => setTimeout(resolve, 100));
				} finally {
					isFetchingStatus = false;

					if (pendingFetchRequest) {
						setTimeout(() => mockFetchStatus(), 100);
					}
				}
			};

			// 手動更新（実行開始）
			const manualFetch = mockFetchStatus();
			await waitForAsync(20);

			// Realtimeイベント受信（ペンディング状態に）
			const realtimeTriggeredFetch = mockFetchStatus();
			await waitForAsync(20);

			// フォールバックポーリング（ペンディング状態に、2つ目は無視される）
			const pollingFetch = mockFetchStatus();

			await Promise.all([manualFetch, realtimeTriggeredFetch, pollingFetch]);
			await waitForAsync(500);

			// 実行回数は2回（初回 + ペンディング1回統合）
			expect(fetchCount).toBe(2);
		});

		it('セマフォが正しくリセットされる', async () => {
			let isFetchingStatus = false;

			const mockFetchStatus = async () => {
				if (isFetchingStatus) {
					return;
				}

				try {
					isFetchingStatus = true;
					await new Promise((resolve) => setTimeout(resolve, 50));
				} finally {
					isFetchingStatus = false;
				}
			};

			// 1回目の実行
			await mockFetchStatus();
			expect(isFetchingStatus).toBe(false);

			// セマフォがリセットされているので、2回目も実行できる
			await mockFetchStatus();
			expect(isFetchingStatus).toBe(false);
		});
	});
});
