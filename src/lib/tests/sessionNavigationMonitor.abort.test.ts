import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ⚠️ createSessionMonitorWithPolling の onPollingData は、直列化の錠の**中で await される**
 * （realtime.ts の pollingRunner）。つまりここから呼ばれるクエリはポーリング経路であり、
 * signal が届いていないと、期限で錠が解放された後も元のクエリが走り続ける。
 *
 * 以前の監査は「既に abortSignal を含むファイル」だけを対象にしていたため、
 * signal を一切使っていない sessionNavigationMonitor が丸ごと視界から漏れていた。
 */

const monitorConfigs: any[] = [];
vi.mock('$lib/realtime', () => ({
	createSessionMonitorWithPolling: vi.fn((_supabase, config) => {
		monitorConfigs.push(config);
		return { cleanup: vi.fn(), getChannel: vi.fn() };
	}),
	createRealtimeChannelWithRetry: vi.fn(() => ({ cleanup: vi.fn() }))
}));

import { createSessionNavigationMonitor } from '$lib/sessionNavigationMonitor';

function makeSupabase(record: (name: string, hasSignal: boolean) => void) {
	return {
		from: vi.fn((table: string) => {
			let sawSignal = false;
			const q: any = {};
			Object.assign(q, {
				select: vi.fn(() => q),
				eq: vi.fn(() => q),
				abortSignal: vi.fn(() => {
					sawSignal = true;
					return q;
				}),
				maybeSingle: vi.fn(async () => {
					record(table, sawSignal);
					return {
						data: table === 'scoring_prompts' ? { id: 'p1', bib_number: 3 } : { id: 'part-1' },
						error: null
					};
				})
			});
			return q;
		})
	} as any;
}

describe('sessionNavigationMonitor のポーリング経路', () => {
	beforeEach(() => {
		monitorConfigs.length = 0;
		vi.clearAllMocks();
	});

	it('onPollingData 経由のクエリすべてに abortSignal が渡る', async () => {
		const seen: Array<{ table: string; hasSignal: boolean }> = [];
		const supabase = makeSupabase((table, hasSignal) => seen.push({ table, hasSignal }));

		createSessionNavigationMonitor({
			supabase,
			sessionId: 's1',
			modeType: 'training',
			eventId: 'e1',
			initialActivePromptId: null,
			onNavigate: vi.fn(),
			onBibChange: vi.fn()
		} as any);

		const cfg = monitorConfigs[0];
		const signal = new AbortController().signal;
		await cfg.onPollingData({ is_active: true, active_prompt_id: 'p1' }, signal);

		expect(seen.length).toBeGreaterThan(0);
		for (const s of seen) {
			expect(s, `${s.table} に abortSignal が渡っていない`).toMatchObject({ hasSignal: true });
		}
	});
});
