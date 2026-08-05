import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RealtimeChannelWithRetryConfig } from './realtime';
import {
	createWaitingSessionMonitor,
	type WaitingSessionMonitorConfig
} from './waitingSessionMonitor';

const cleanup = vi.fn();
let monitorConfig: RealtimeChannelWithRetryConfig | null;

vi.mock('$lib/realtime', () => ({
	createRealtimeChannelWithRetry: vi.fn((_supabase, config) => {
		monitorConfig = config;
		return {
			cleanup,
			getChannel: vi.fn(),
			hasConnectionError: vi.fn(() => false),
			manualRefresh: vi.fn()
		};
	})
}));

type QueryResponse = { data: unknown; error: unknown };
type ResponseMap = Record<string, { single?: QueryResponse; maybeSingle?: QueryResponse }>;

interface MockQuery {
	select: ReturnType<typeof vi.fn>;
	eq: ReturnType<typeof vi.fn>;
	single: ReturnType<typeof vi.fn>;
	maybeSingle: ReturnType<typeof vi.fn>;
}

function createSupabase(responses: ResponseMap) {
	const queries: Array<{ table: string; query: MockQuery }> = [];
	return {
		from: vi.fn((table: string) => {
			const query = {} as MockQuery;
			Object.assign(query, {
				select: vi.fn(() => query),
				// 実装は期限切れ・画面離脱でクエリを中断できるよう abortSignal を通す
				abortSignal: vi.fn(() => query),
				eq: vi.fn(() => query),
				single: vi.fn(async () => responses[table]?.single ?? { data: null, error: null }),
				maybeSingle: vi.fn(async () => responses[table]?.maybeSingle ?? { data: null, error: null })
			});
			queries.push({ table, query });
			return query;
		}),
		_queries: queries
	};
}

function currentMonitorConfig() {
	if (!monitorConfig) throw new Error('monitor config was not captured');
	return monitorConfig;
}

function setup(responses: ResponseMap = {}, overrides: Partial<WaitingSessionMonitorConfig> = {}) {
	const onNavigate = vi.fn();
	const onBibChange = vi.fn();
	const onSessionEnded = vi.fn();
	const supabase = createSupabase(responses);

	const handle = createWaitingSessionMonitor({
		supabase: supabase as unknown as SupabaseClient,
		sessionId: 123,
		initialPromptId: null,
		shouldShowJoinUI: false,
		identity: {
			guestIdentifier: null,
			userId: 'judge-1',
			userEmail: 'judge@example.com',
			profileName: 'Judge One'
		},
		isPageActive: () => true,
		isSessionEnded: () => false,
		onSessionEnded,
		onBibChange,
		onNavigate,
		...overrides
	});

	return { handle, supabase, onNavigate, onBibChange, onSessionEnded };
}

describe('createWaitingSessionMonitor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		monitorConfig = null;
	});

	it('待機画面用のsessions監視と3秒フォールバックを設定する', () => {
		setup();

		expect(currentMonitorConfig()).toEqual(
			expect.objectContaining({
				channelName: 'session-status-123',
				table: 'sessions',
				event: 'UPDATE',
				filter: 'id=eq.123',
				pollingIntervalMs: 3000,
				startPollingImmediately: true,
				startPollingOnErrorStatus: true
			})
		);
	});

	it('Realtimeで検定の新しい採点指示を受けると採点画面へ遷移する', async () => {
		const { onNavigate, onBibChange } = setup({
			scoring_prompts: {
				single: {
					data: {
						id: 'prompt-1',
						bib_number: 12,
						discipline: 'trampoline',
						level: 'class-a',
						event_name: 'routine'
					},
					error: null
				}
			}
		});

		await currentMonitorConfig().onPayload({
			old: { status: 'active', active_prompt_id: null },
			new: { status: 'active', active_prompt_id: 'prompt-1' }
		});

		expect(onBibChange).toHaveBeenCalledWith(12);
		expect(onNavigate).toHaveBeenCalledWith('/session/123/trampoline/class-a/routine/score');
	});

	it('接続時に大会の既存採点があれば待機画面に留まる', async () => {
		const { onNavigate, onBibChange, supabase } = setup(
			{
				sessions: {
					single: { data: { status: 'active', active_prompt_id: 'prompt-2' }, error: null }
				},
				scoring_prompts: {
					single: {
						data: {
							id: 'prompt-2',
							bib_number: 34,
							discipline: 'tournament',
							level: 'event-1',
							event_name: ''
						},
						error: null
					}
				},
				participants: { maybeSingle: { data: { id: 88 }, error: null } },
				results: { maybeSingle: { data: { id: 99 }, error: null } }
			},
			{ initialPromptId: 'prompt-2' }
		);

		await currentMonitorConfig().onSubscribed?.();

		expect(onBibChange).not.toHaveBeenCalled();
		expect(onNavigate).not.toHaveBeenCalled();
		const resultsQuery = supabase._queries.find(({ table }) => table === 'results')?.query;
		expect(resultsQuery?.eq).toHaveBeenCalledWith('judge_id', 'judge-1');
		expect(resultsQuery?.eq).not.toHaveBeenCalledWith('judge_name', 'Judge One');
	});

	it('再接続時はinitialPromptIdではなく現在のpromptをDBから取得する', async () => {
		const { onNavigate } = setup(
			{
				sessions: {
					single: { data: { status: 'active', active_prompt_id: 'prompt-new' }, error: null }
				},
				scoring_prompts: {
					single: {
						data: {
							id: 'prompt-new',
							bib_number: 45,
							discipline: 'trampoline',
							level: 'class-b',
							event_name: 'routine'
						},
						error: null
					}
				}
			},
			{ initialPromptId: 'prompt-old' }
		);

		await currentMonitorConfig().onSubscribed?.();

		expect(onNavigate).toHaveBeenCalledWith('/session/123/trampoline/class-b/routine/score');
	});

	it('ポーリングで研修の新しい採点指示を検知すると未採点者だけ遷移する', async () => {
		const { onNavigate, onBibChange } = setup({
			sessions: {
				single: { data: { status: 'active', active_prompt_id: 'prompt-3' }, error: null }
			},
			scoring_prompts: {
				single: {
					data: {
						id: 'prompt-3',
						bib_number: 56,
						discipline: 'training',
						level: 'event-2',
						event_name: ''
					},
					error: null
				}
			},
			participants: { maybeSingle: { data: { id: 77 }, error: null } },
			training_scores: { maybeSingle: { data: null, error: null } }
		});

		await currentMonitorConfig().pollingFn();

		expect(onBibChange).toHaveBeenCalledWith(56);
		expect(onNavigate).toHaveBeenCalledWith(
			'/session/123/score/training/event-2/input?bib=56&participantId=77'
		);
	});

	it('終了を検知すると監視を止めて終了画面へ遷移する', async () => {
		const { onNavigate, onSessionEnded } = setup();

		await currentMonitorConfig().onPayload({
			old: { status: 'active', active_prompt_id: null },
			new: { status: 'ended', active_prompt_id: null }
		});

		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(onSessionEnded).toHaveBeenCalledTimes(1);
		expect(onNavigate).toHaveBeenCalledWith('/session/123?ended=true');
	});

	it('終了画面でRealtimeから再開を検知すると待機画面へ戻る', async () => {
		const { onNavigate } = setup({}, { isSessionEnded: () => true });

		await currentMonitorConfig().onPayload({
			old: { status: 'ended', active_prompt_id: null },
			new: { status: 'active', active_prompt_id: null }
		});

		expect(onNavigate).toHaveBeenCalledWith('/session/123');
	});

	it('終了画面でpollingから再開を検知すると待機画面へ戻る', async () => {
		const { onNavigate } = setup(
			{
				sessions: {
					single: { data: { status: 'active', active_prompt_id: null }, error: null }
				}
			},
			{ isSessionEnded: () => true }
		);

		await currentMonitorConfig().pollingFn();

		expect(onNavigate).toHaveBeenCalledWith('/session/123');
	});

	it('prompt取得中に画面を離れた場合は遷移しない', async () => {
		let pageActive = true;
		const { onNavigate, onBibChange } = setup(
			{
				scoring_prompts: {
					single: {
						data: {
							id: 'prompt-4',
							bib_number: 67,
							discipline: 'trampoline',
							level: 'class-c',
							event_name: 'routine'
						},
						error: null
					}
				}
			},
			{ isPageActive: () => pageActive }
		);

		const navigation = currentMonitorConfig().onPayload({
			old: { status: 'active', active_prompt_id: null },
			new: { status: 'active', active_prompt_id: 'prompt-4' }
		});
		pageActive = false;
		await navigation;

		expect(onBibChange).not.toHaveBeenCalled();
		expect(onNavigate).not.toHaveBeenCalled();
	});
});
