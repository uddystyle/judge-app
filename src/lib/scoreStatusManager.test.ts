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

/** 直近に生成した supabase モックの from スパイ（クエリ発行の観測用） */
let lastFrom: ReturnType<typeof vi.fn>;

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
	lastFrom = vi.fn(() => query);
	return { from: lastFrom } as unknown as SupabaseClient;
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

/**
 * DELETE payload の扱い
 *
 * ⚠️ Supabase 公式ドキュメント:
 *   "RLS policies are not applied to DELETE statements... When RLS is enabled and
 *    replica identity is set to full on a table, the old record contains only the
 *    primary key(s)."
 *
 * つまり RLS 有効なテーブルでは、REPLICA IDENTITY FULL にしても DELETE の `old` には
 * **主キーしか入らない**。以前のハンドラは payload.old の非主キー列
 * （guest_identifier / judge_id / discipline / level / event_name）で対象を絞っており、
 * それらが undefined になるため**採点削除が即時反映されない**（ヘルスポーリング頼み）。
 *
 * DELETE を受けたら payload に頼らず正規状態を再取得する。
 */
describe('DELETE 受信時は payload に頼らず再取得する', () => {
	beforeEach(() => {
		configs.length = 0;
		vi.clearAllMocks();
	});

	function setup(isTrainingMode: boolean) {
		const onStatusChange = vi.fn();
		// 研修モードのハンドラは athleteId が無いと早期 return する（実運用では設定済み）
		const manager = createScoreStatusManager(
			baseConfig({ isTrainingMode, onStatusChange, initialAthleteId: 'athlete-1' })
		);
		manager.setupRealtime();
		return { onStatusChange, payload: configs[0].onPayload! };
	}

	it('研修モード: 主キーのみの DELETE payload でも再取得が走る', async () => {
		const { payload } = setup(true);

		// RLS 下で実際に届く形（主キーのみ。judge_id も guest_identifier も無い）
		await payload({ eventType: 'DELETE', old: { id: 42 }, new: {} } as never);
		await new Promise((r) => setTimeout(r, 10));

		// 再取得のためにクエリが発行されていること
		expect(configs[0].pollingFn).toBeDefined();
		expect(lastFrom).toHaveBeenCalled();
	});

	it('検定モード: 主キーのみの DELETE payload でも再取得が走る', async () => {
		// 検定モードの再取得は /api/score-status/... への fetch
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue({ ok: true, json: async () => ({ scores: [] }) } as Response);
		try {
			const { payload } = setup(false);

			await payload({ eventType: 'DELETE', old: { id: 42 }, new: {} } as never);
			await new Promise((r) => setTimeout(r, 10));

			expect(fetchSpy).toHaveBeenCalledWith(
				expect.stringContaining('/api/score-status/'),
				expect.objectContaining({ signal: expect.any(AbortSignal) })
			);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it('DELETE では payload.old の非主キー列で絞り込まない（届かないため）', async () => {
		const { onStatusChange } = setup(true);
		const { payload } = setup(true);

		// old に judge_id が入っていない状況で、ローカル状態を勝手に書き換えないこと
		await payload({ eventType: 'DELETE', old: { id: 42 }, new: {} } as never);

		// payload だけを根拠にした差分適用は行わない（再取得の結果で更新される）
		expect(onStatusChange).not.toHaveBeenCalledWith(
			expect.objectContaining({ scores: expect.any(Array) })
		);
	});
});

/**
 * リクエスト期限が実クエリまで届くこと
 *
 * ⚠️ 以前は pollingFn が内側の run() を投げっぱなしにして即 resolve していたため、
 * realtime 側の15秒期限は**即座に解決する Promise を監視しているだけ**で、
 * 実際の Supabase クエリを一切見張っていなかった。内側にも期限が無く、
 * クエリがハングすると内側の錠が永久に残る。
 *
 * また期限で錠を解放しても、signal がクエリに届いていなければ元の処理は止まらず、
 * 「常に1件だけ実行する」という直列化の契約が崩れる（二重実行になる）。
 */
describe('ポーリングの期限が実クエリまで届く', () => {
	beforeEach(() => {
		configs.length = 0;
		vi.clearAllMocks();
	});

	it('pollingFn は実際の取得完了を待つ（投げっぱなしにしない）', async () => {
		// すべての終端操作が同じ約束を返す。解決するまで取得は完了しない
		let release: (() => void) | undefined;
		const gate = new Promise<{ data: never[]; error: null; count: number }>((res) => {
			release = () => res({ data: [], error: null, count: 0 });
		});

		const supabase = createSupabase();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(supabase as any).from = vi.fn(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const q: any = {};
			Object.assign(q, {
				select: vi.fn(() => q),
				eq: vi.fn(() => q),
				in: vi.fn(() => q),
				not: vi.fn(() => q),
				order: vi.fn(() => q),
				limit: vi.fn(() => q),
				abortSignal: vi.fn(() => q),
				single: vi.fn(() => gate),
				maybeSingle: vi.fn(() => gate),
				then: (r: (v: unknown) => unknown) => gate.then(r)
			});
			return q;
		});

		const manager = createScoreStatusManager(
			baseConfig({ supabase, isTrainingMode: true, initialAthleteId: 'athlete-1' })
		);
		manager.setupRealtime();

		let settled = false;
		void configs[0].pollingFn().then(() => {
			settled = true;
		});
		await new Promise((r) => setTimeout(r, 20));

		// クエリが未完了の間は pollingFn も解決しない
		expect(settled).toBe(false);

		release?.();
		await new Promise((r) => setTimeout(r, 20));
		expect(settled).toBe(true);
	});

	it('Supabase クエリに abortSignal が渡される', async () => {
		const abortSignalSpy = vi.fn();
		const supabase = createSupabase();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(supabase as any).from = vi.fn(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const q: any = {};
			Object.assign(q, {
				select: vi.fn(() => q),
				eq: vi.fn(() => q),
				in: vi.fn(() => q),
				order: vi.fn(() => q),
				limit: vi.fn(() => q),
				abortSignal: vi.fn((s: AbortSignal) => {
					abortSignalSpy(s);
					return q;
				}),
				single: vi.fn(async () => ({ data: null, error: null })),
				maybeSingle: vi.fn(async () => ({ data: null, error: null })),
				then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
			});
			return q;
		});

		const manager = createScoreStatusManager(
			baseConfig({ supabase, isTrainingMode: true, initialAthleteId: 'athlete-1' })
		);
		manager.setupRealtime();
		await configs[0].pollingFn();

		expect(abortSignalSpy).toHaveBeenCalled();
		expect(abortSignalSpy.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
	});
});
