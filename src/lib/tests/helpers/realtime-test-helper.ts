/**
 * Realtimeテスト用のヘルパー関数
 */

import type { MockSupabaseRealtime } from '../mocks/supabase-realtime';

/**
 * スコアINSERTイベントをシミュレート
 */
export function simulateScoreInsert(
	mockRealtime: MockSupabaseRealtime,
	channelName: string,
	score: {
		id: string;
		judge_id?: string;
		guest_identifier?: string;
		score: number;
		event_id: string;
		athlete_id: string;
	}
) {
	mockRealtime.simulateEvent(channelName, 'INSERT', 'training_scores', {
		new: score
	});
}

/**
 * スコアUPDATEイベントをシミュレート
 */
export function simulateScoreUpdate(
	mockRealtime: MockSupabaseRealtime,
	channelName: string,
	oldScore: any,
	newScore: any
) {
	mockRealtime.simulateEvent(channelName, 'UPDATE', 'training_scores', {
		old: oldScore,
		new: newScore
	});
}

/**
 * スコアDELETEイベントをシミュレート
 */
export function simulateScoreDelete(
	mockRealtime: MockSupabaseRealtime,
	channelName: string,
	score: any
) {
	mockRealtime.simulateEvent(channelName, 'DELETE', 'training_scores', {
		old: score
	});
}

/**
 * セッション終了イベントをシミュレート
 */
export function simulateSessionEnd(
	mockRealtime: MockSupabaseRealtime,
	channelName: string,
	sessionId: string
) {
	mockRealtime.simulateEvent(channelName, 'UPDATE', 'sessions', {
		old: { id: sessionId, is_active: true, active_prompt_id: null },
		new: { id: sessionId, is_active: false, active_prompt_id: null }
	});
}

/**
 * 複数の検定員が同時にスコアを入力するシミュレーション
 */
export async function simulateMultipleJudgesScoring(
	mockRealtime: MockSupabaseRealtime,
	channelName: string,
	judges: Array<{ id: string; name: string; score: number }>,
	eventId: string,
	athleteId: string,
	delayMs: number = 100
) {
	for (const judge of judges) {
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		simulateScoreInsert(mockRealtime, channelName, {
			id: `score_${judge.id}`,
			judge_id: judge.id,
			score: judge.score,
			event_id: eventId,
			athlete_id: athleteId
		});
	}
}

/**
 * 待機ヘルパー（非同期処理の完了を待つ）
 */
export function waitForAsync(ms: number = 10): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * テストデータ生成: 検定員リスト
 */
export function createMockJudges(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		id: `judge_${i + 1}`,
		name: `検定員${i + 1}`,
		email: `judge${i + 1}@example.com`
	}));
}

/**
 * テストデータ生成: スコアリスト
 */
export function createMockScores(
	judges: Array<{ id: string; name: string }>,
	eventId: string,
	athleteId: string,
	baseScore: number = 80
) {
	return judges.map((judge, i) => ({
		id: `score_${judge.id}`,
		judge_id: judge.id,
		guest_identifier: null,
		score: baseScore + i,
		event_id: eventId,
		athlete_id: athleteId,
		created_at: new Date().toISOString()
	}));
}

/**
 * テストデータ生成: ゲスト検定員
 */
export function createMockGuestJudge(index: number) {
	return {
		guest_identifier: `guest_${index}`,
		guest_name: `ゲスト検定員${index}`
	};
}

/**
 * N+1問題の検証: クエリ数をカウント
 */
export class QueryCounter {
	private queryCount: number = 0;
	private queries: Array<{ table: string; operation: string }> = [];

	incrementQuery(table: string, operation: string) {
		this.queryCount++;
		this.queries.push({ table, operation });
	}

	getCount(): number {
		return this.queryCount;
	}

	getQueries() {
		return this.queries;
	}

	reset() {
		this.queryCount = 0;
		this.queries = [];
	}

	// N+1問題が解決されているか確認（期待値以下のクエリ数）
	assertQueryCountLessThan(expected: number, message?: string) {
		if (this.queryCount > expected) {
			throw new Error(
				message ||
					`N+1 problem detected: ${this.queryCount} queries executed (expected <= ${expected})\n` +
						`Queries: ${JSON.stringify(this.queries, null, 2)}`
			);
		}
	}
}

/**
 * Realtimeチャンネルの接続待機
 */
export async function waitForChannelSubscription(
	mockRealtime: MockSupabaseRealtime,
	channelName: string,
	timeoutMs: number = 1000
): Promise<void> {
	const startTime = Date.now();
	while (!mockRealtime.isChannelSubscribed(channelName)) {
		if (Date.now() - startTime > timeoutMs) {
			throw new Error(`Channel ${channelName} subscription timeout`);
		}
		await waitForAsync(10);
	}
}
