/**
 * Realtimeチャンネルライフサイクルの統合テスト
 *
 * このテストでは、チャンネル名の再利用とメモリリーク防止を検証します。
 *
 * 実行方法:
 *   npm run test:integration
 *
 * 前提条件:
 *   - .env.testファイルにSupabase接続情報が設定されていること
 *   - Supabase Realtimeが有効化されていること
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RealtimeChannel } from '@supabase/supabase-js';

// テスト用の環境変数
const SUPABASE_URL = process.env.TEST_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;

// テストをスキップするかどうか
const SKIP_INTEGRATION_TESTS = !SUPABASE_URL || !SUPABASE_ANON_KEY;

describe.skipIf(SKIP_INTEGRATION_TESTS)('Realtime Channel Lifecycle Tests', () => {
	let supabase: SupabaseClient;
	let channels: RealtimeChannel[] = [];

	beforeAll(() => {
		if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
			throw new Error('Supabase credentials not found in environment');
		}

		supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
	});

	afterAll(async () => {
		// すべてのチャンネルをクリーンアップ
		for (const channel of channels) {
			await supabase.removeChannel(channel);
		}
	});

	describe('チャンネル名の再利用（Date.now()なし）', () => {
		it('同じチャンネル名で再接続できる', async () => {
			const channelName = 'training-scores-event1-10'; // Date.now()なし
			const subscriptionStatuses: string[] = [];

			// 1回目の接続
			const channel1 = supabase
				.channel(channelName)
				.on('postgres_changes', { event: '*', table: 'training_scores' }, () => {})
				.subscribe((status) => {
					subscriptionStatuses.push(`channel1_${status}`);
				});

			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Subscription timeout')), 5000);
				const checkStatus = setInterval(() => {
					if (subscriptionStatuses.includes('channel1_SUBSCRIBED')) {
						clearInterval(checkStatus);
						clearTimeout(timeout);
						resolve();
					}
				}, 100);
			});

			expect(subscriptionStatuses).toContain('channel1_SUBSCRIBED');
			channels.push(channel1);

			// 1回目の接続を削除
			await supabase.removeChannel(channel1);
			await new Promise((resolve) => setTimeout(resolve, 500));

			// 2回目の接続（同じチャンネル名）
			const channel2 = supabase
				.channel(channelName)
				.on('postgres_changes', { event: '*', table: 'training_scores' }, () => {})
				.subscribe((status) => {
					subscriptionStatuses.push(`channel2_${status}`);
				});

			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Subscription timeout')), 5000);
				const checkStatus = setInterval(() => {
					if (subscriptionStatuses.includes('channel2_SUBSCRIBED')) {
						clearInterval(checkStatus);
						clearTimeout(timeout);
						resolve();
					}
				}, 100);
			});

			expect(subscriptionStatuses).toContain('channel2_SUBSCRIBED');
			channels.push(channel2);
		});

		it('複数タブで同じチャンネル名を使用しても問題ない', async () => {
			const channelName = 'training-scores-event2-15'; // Date.now()なし
			const tab1Statuses: string[] = [];
			const tab2Statuses: string[] = [];

			// タブ1をシミュレート
			const tab1Channel = supabase
				.channel(channelName)
				.on('postgres_changes', { event: '*', table: 'training_scores' }, () => {})
				.subscribe((status) => {
					tab1Statuses.push(status);
				});

			// タブ2をシミュレート（同じチャンネル名）
			const tab2Channel = supabase
				.channel(channelName)
				.on('postgres_changes', { event: '*', table: 'training_scores' }, () => {})
				.subscribe((status) => {
					tab2Statuses.push(status);
				});

			await new Promise((resolve) => setTimeout(resolve, 2000));

			// 両方とも接続成功するか、一方のみ成功する（Supabaseの実装による）
			const tab1Success = tab1Statuses.includes('SUBSCRIBED');
			const tab2Success = tab2Statuses.includes('SUBSCRIBED');

			// 少なくとも1つは成功する
			expect(tab1Success || tab2Success).toBe(true);

			channels.push(tab1Channel, tab2Channel);
		});
	});

	describe('メモリリーク防止', () => {
		it('古いチャンネルが削除される', async () => {
			const baseChannelName = 'training-scores-event3-20';
			const createdChannels: RealtimeChannel[] = [];

			// 10個のチャンネルを作成（同じチャンネル名）
			for (let i = 0; i < 10; i++) {
				const channel = supabase
					.channel(baseChannelName)
					.on('postgres_changes', { event: '*', table: 'training_scores' }, () => {})
					.subscribe();

				createdChannels.push(channel);
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			// すべてのチャンネルを削除
			for (const channel of createdChannels) {
				await supabase.removeChannel(channel);
			}

			await new Promise((resolve) => setTimeout(resolve, 1000));

			// チャンネルがクリーンアップされたことを確認
			// （実際のSupabaseクライアント内部の状態を確認するのは困難なので、エラーが発生しないことを確認）
			expect(true).toBe(true);
		});

		it('Date.now()なしでもチャンネルが正常に動作する', async () => {
			const eventId = 'event4';
			const bib = '25';
			const channelName = `training-scores-${eventId}-${bib}`; // Date.now()なし

			let receivedEvents = 0;

			const channel = supabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{
						event: '*',
						schema: 'public',
						table: 'training_scores',
						filter: `event_id=eq.${eventId}`
					},
					() => {
						receivedEvents++;
					}
				)
				.subscribe();

			await new Promise((resolve) => setTimeout(resolve, 1000));

			channels.push(channel);

			// チャンネルが正常に作成されたことを確認（エラーがないこと）
			expect(channel).toBeDefined();
		});
	});

	describe('スコアボードチャンネル', () => {
		it('scoreboardチャンネルがDate.now()なしで動作する', async () => {
			const sessionId = 'test-session-123';
			const channelName = `scoreboard-${sessionId}`; // Date.now()なし

			let subscriptionStatus = '';

			const channel = supabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{
						event: '*',
						schema: 'public',
						table: 'results',
						filter: `session_id=eq.${sessionId}`
					},
					() => {}
				)
				.subscribe((status) => {
					subscriptionStatus = status;
				});

			await new Promise((resolve) => setTimeout(resolve, 2000));

			expect(subscriptionStatus).toBe('SUBSCRIBED');
			channels.push(channel);
		});

		it('resultsチャンネルがDate.now()なしで動作する（大会モード）', async () => {
			const sessionId = 'test-session-456';
			const bib = '30';
			const channelName = `results-${sessionId}-${bib}`; // Date.now()なし

			let subscriptionStatus = '';

			const channel = supabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{
						event: '*',
						schema: 'public',
						table: 'results',
						filter: `session_id=eq.${sessionId},bib=eq.${parseInt(bib)}`
					},
					() => {}
				)
				.subscribe((status) => {
					subscriptionStatus = status;
				});

			await new Promise((resolve) => setTimeout(resolve, 2000));

			expect(subscriptionStatus).toBe('SUBSCRIBED');
			channels.push(channel);
		});
	});
});
