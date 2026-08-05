import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RealtimeChannelWithRetryConfig } from './realtime';
import { createScoreStatusManager, type ScoreStatusManagerConfig } from './scoreStatusManager';

/**
 * 採点状況画面の Realtime 設定。
 *
 * ⚠️ 背景: この画面だけ startPollingImmediately / startPollingOnErrorStatus を
 * 指定しておらず、初回に Realtime へ繋がらないと**再購読を5回使い切るまで
 * ポーリングが始まらない**。realtime.ts の DEFAULT_MAX_RETRY=5 と
 * Math.pow(2, n)*1000 のバックオフ（1+2+4+8+16=31秒）に接続タイムアウトが加わり、
 * 最悪で 90 秒近くフォールバックが始まらない。
 *
 * 待機画面（waitingSessionMonitor）とスコアボードは既に即時ポーリングを有効にしている。
 * 採点状況は現場で「点が入ったか」を見る画面なので、同じ扱いに揃える。
 */

const cleanup = vi.fn();
const configs: RealtimeChannelWithRetryConfig[] = [];

vi.mock('$lib/realtime', () => ({
	createRealtimeChannelWithRetry: vi.fn((_supabase, config) => {
		configs.push(config);
		return {
			cleanup,
			getChannel: vi.fn(),
			hasConnectionError: vi.fn(() => false),
			manualRefresh: vi.fn()
		};
	})
}));

function createSupabase() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const query: any = {};
	Object.assign(query, {
		select: vi.fn(() => query),
		eq: vi.fn(() => query),
		in: vi.fn(() => query),
		order: vi.fn(() => query),
		limit: vi.fn(() => query),
		single: vi.fn(async () => ({ data: null, error: null })),
		maybeSingle: vi.fn(async () => ({ data: null, error: null })),
		then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
	});
	return { from: vi.fn(() => query) } as unknown as SupabaseClient;
}

function baseConfig(overrides: Partial<ScoreStatusManagerConfig> = {}): ScoreStatusManagerConfig {
	return {
		supabase: createSupabase(),
		sessionId: 'session-1',
		eventId: 'event-1',
		bib: '12',
		isTrainingMode: false,
		totalJudges: 3,
		eventInfo: { discipline: 'ski', level: '1', event_name: 'test' },
		excludeExtremes: false,
		initialStatus: { scores: [], requiredJudges: 3 },
		initialAthleteId: null,
		onStatusChange: vi.fn(),
		onConnectionError: vi.fn(),
		...overrides
	};
}

describe('scoreStatusManager の Realtime フォールバック設定', () => {
	beforeEach(() => {
		configs.length = 0;
		vi.clearAllMocks();
	});

	it('検定モード: Realtime 障害を待たずにポーリングを開始する', () => {
		const manager = createScoreStatusManager(baseConfig({ isTrainingMode: false }));
		manager.setupRealtime();

		expect(configs).toHaveLength(1);
		expect(configs[0]).toEqual(
			expect.objectContaining({
				table: 'results',
				startPollingImmediately: true,
				startPollingOnErrorStatus: true
			})
		);
	});

	it('研修モード: 同じくポーリングを即時開始する', () => {
		const manager = createScoreStatusManager(baseConfig({ isTrainingMode: true }));
		manager.setupRealtime();

		expect(configs).toHaveLength(1);
		expect(configs[0]).toEqual(
			expect.objectContaining({
				table: 'training_scores',
				startPollingImmediately: true,
				startPollingOnErrorStatus: true
			})
		);
	});

	it('待機画面と同じ設定になっている（画面ごとに挙動が割れないこと）', () => {
		// waitingSessionMonitor.ts / scoreboard は既に両方 true。
		// 採点状況だけ既定値のままだと、同じ障害でも画面によって復旧時間が変わる。
		const manager = createScoreStatusManager(baseConfig());
		manager.setupRealtime();

		const cfg = configs[0] as RealtimeChannelWithRetryConfig;
		expect(cfg.startPollingImmediately).toBe(true);
		expect(cfg.startPollingOnErrorStatus).toBe(true);
	});
});
