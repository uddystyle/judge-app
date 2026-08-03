import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	createSessionNavigationMonitor,
	type SessionNavigationConfig
} from './sessionNavigationMonitor';

interface CapturedMonitorConfig {
	onPollingData: (data: {
		is_active: boolean;
		active_prompt_id: string | null;
	}) => void | Promise<void>;
	onRealtimePayload: (payload: {
		old?: { is_active: boolean; active_prompt_id: string | null };
		new: { is_active: boolean; active_prompt_id: string | null };
	}) => void | Promise<void>;
}

interface MockQuery {
	select: ReturnType<typeof vi.fn>;
	eq: ReturnType<typeof vi.fn>;
	maybeSingle: ReturnType<typeof vi.fn>;
}

let monitorConfig: CapturedMonitorConfig | null = null;
const cleanup = vi.fn();

vi.mock('$lib/realtime', () => ({
	createSessionMonitorWithPolling: vi.fn((_supabase, config) => {
		monitorConfig = config;
		return { cleanup, getChannel: vi.fn(() => null) };
	})
}));

function createSupabase() {
	return {
		from: vi.fn((table: string) => {
			const query = {} as MockQuery;
			query.select = vi.fn(() => query);
			query.eq = vi.fn(() => query);
			query.maybeSingle = vi.fn(async () => {
				if (table === 'scoring_prompts') {
					return { data: { bib_number: 22 }, error: null };
				}
				if (table === 'participants') {
					return { data: { id: 91 }, error: null };
				}
				return { data: null, error: null };
			});
			return query;
		})
	};
}

function currentMonitorConfig() {
	if (!monitorConfig) throw new Error('monitor config was not captured');
	return monitorConfig;
}

function setup(overrides: Partial<SessionNavigationConfig> = {}) {
	const onNavigate = vi.fn();
	const onBibChange = vi.fn();
	const supabase = createSupabase();
	const handle = createSessionNavigationMonitor({
		supabase: supabase as unknown as SupabaseClient,
		sessionId: 'session-1',
		modeType: 'tournament',
		eventId: 'event-1',
		onNavigate,
		onBibChange,
		...overrides
	});
	return { handle, onNavigate, onBibChange };
}

describe('createSessionNavigationMonitor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		monitorConfig = null;
	});

	it('polling初回はシードだけ行い、prompt変更時だけ遷移する', async () => {
		const { onNavigate, onBibChange } = setup();

		await currentMonitorConfig().onPollingData({
			is_active: true,
			active_prompt_id: 'prompt-1'
		});
		expect(onNavigate).not.toHaveBeenCalled();

		await currentMonitorConfig().onPollingData({
			is_active: true,
			active_prompt_id: 'prompt-2'
		});
		expect(onBibChange).toHaveBeenCalledWith(22);
		expect(onNavigate).toHaveBeenCalledWith(
			'/session/session-1/score/tournament/event-1/input?bib=22&participantId=91'
		);
	});

	it('prompt取得中にcleanupされた場合は遷移しない', async () => {
		const { handle, onNavigate, onBibChange } = setup();

		const navigation = currentMonitorConfig().onRealtimePayload({
			old: { is_active: true, active_prompt_id: null },
			new: { is_active: true, active_prompt_id: 'prompt-2' }
		});
		handle.cleanup();
		await navigation;

		expect(onBibChange).not.toHaveBeenCalled();
		expect(onNavigate).not.toHaveBeenCalled();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it('遅いprompt取得中に終了payloadが届いても採点画面へ戻らない', async () => {
		const { onNavigate, onBibChange } = setup();

		const promptNavigation = currentMonitorConfig().onRealtimePayload({
			new: { is_active: true, active_prompt_id: 'prompt-2' }
		});
		await currentMonitorConfig().onRealtimePayload({
			new: { is_active: false, active_prompt_id: 'prompt-2' }
		});
		await promptNavigation;

		expect(onNavigate).toHaveBeenCalledOnce();
		expect(onNavigate).toHaveBeenCalledWith('/session/session-1?ended=true');
		expect(onBibChange).not.toHaveBeenCalled();
	});

	it('Realtimeとpollingが同じpromptを検知しても遷移は一度だけ', async () => {
		const { onNavigate } = setup();

		const realtimeNavigation = currentMonitorConfig().onRealtimePayload({
			new: { is_active: true, active_prompt_id: 'prompt-2' }
		});
		const pollingNavigation = currentMonitorConfig().onPollingData({
			is_active: true,
			active_prompt_id: 'prompt-2'
		});
		await Promise.all([realtimeNavigation, pollingNavigation]);

		expect(onNavigate).toHaveBeenCalledOnce();
	});

	it('初期promptをシードし、complete画面で同じpromptへ戻さない', async () => {
		const { onNavigate } = setup({ initialActivePromptId: 'prompt-2' });

		await currentMonitorConfig().onRealtimePayload({
			new: { is_active: true, active_prompt_id: 'prompt-2' }
		});

		expect(onNavigate).not.toHaveBeenCalled();
	});

	it('legacy complete用の遷移URLを共通ガード内で構築できる', async () => {
		const { onNavigate } = setup({
			buildPromptUrl: (prompt) => `/legacy/${prompt.bib_number}/score`,
			promptFallbackUrl: '/legacy/waiting'
		});

		await currentMonitorConfig().onRealtimePayload({
			new: { is_active: true, active_prompt_id: 'prompt-2' }
		});

		expect(onNavigate).toHaveBeenCalledWith('/legacy/22/score');
	});
});
