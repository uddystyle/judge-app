import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/rateLimit', () => ({
	rateLimiters: undefined,
	checkRateLimit: vi.fn(async () => ({ success: true }))
}));

vi.mock('$lib/server/sessionAuth', () => ({
	authenticateAction: vi.fn()
}));

import { GET } from './+server';
import { authenticateAction } from '$lib/server/sessionAuth';

function makeChain(result: unknown = { data: null, error: null }) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const c: any = {};
	for (const m of ['select', 'eq', 'neq', 'is', 'in', 'order', 'limit']) {
		c[m] = vi.fn(() => c);
	}
	c.single = vi.fn(async () => result);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	c.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
	return c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSupabase(queues: Record<string, any[]>) {
	return {
		from: vi.fn((table: string) => {
			const q = queues[table];
			if (!q || q.length === 0) throw new Error(`unexpected from(${table})`);
			return q.length > 1 ? q.shift() : q[0];
		})
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeEvent = (supabase: any, guest: string | null = null) =>
	({
		params: { sessionId: '1' },
		url: new URL(`http://localhost/api/sessions/1/offline-bundle${guest ? `?guest=${guest}` : ''}`),
		request: new Request('http://localhost/api/sessions/1/offline-bundle'),
		locals: { supabase }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('GET /api/sessions/[sessionId]/offline-bundle', () => {
	it('未認証は 401', async () => {
		vi.mocked(authenticateAction).mockResolvedValueOnce(null);

		await expect(GET(makeEvent(makeSupabase({})))).rejects.toMatchObject({ status: 401 });
	});

	it('研修セッションは participants + training_events を返す', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(authenticateAction).mockResolvedValueOnce({ user: { id: 'u1' } } as any);
		const supabase = makeSupabase({
			sessions: [
				makeChain({
					data: { id: 1, name: '研修A', mode: 'training', is_tournament_mode: false },
					error: null
				})
			],
			participants: [
				makeChain({
					data: [{ id: 10, bib_number: 5, athlete_name: '選手5', team_name: null }],
					error: null
				})
			],
			training_events: [
				makeChain({
					data: [{ id: 100, name: '小回り', min_score: 0, max_score: 100 }],
					error: null
				})
			]
		});

		const res = await GET(makeEvent(supabase));
		const body = await res.json();

		expect(body.mode).toBe('training');
		expect(body.session_name).toBe('研修A');
		expect(body.participants).toHaveLength(1);
		expect(body.training_events).toHaveLength(1);
		expect(body.custom_events).toHaveLength(0);
	});

	it('大会セッションは custom_events を返す（ゲスト識別子は authenticateAction へ渡る）', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(authenticateAction).mockResolvedValueOnce({ guestParticipant: {} } as any);
		const supabase = makeSupabase({
			sessions: [
				makeChain({
					data: { id: 1, name: '大会A', mode: null, is_tournament_mode: true },
					error: null
				})
			],
			participants: [makeChain({ data: [], error: null })],
			custom_events: [
				makeChain({
					data: [{ id: 200, discipline: 'tournament', level: '200', event_name: '大回り' }],
					error: null
				})
			]
		});

		const res = await GET(makeEvent(supabase, 'guest-1'));
		const body = await res.json();

		expect(vi.mocked(authenticateAction).mock.calls[0]![2]).toBe('guest-1');
		expect(body.mode).toBe('tournament');
		expect(body.custom_events).toHaveLength(1);
	});

	it('検定セッションは participants のみ（種目クエリなし）', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(authenticateAction).mockResolvedValueOnce({ user: { id: 'u1' } } as any);
		const supabase = makeSupabase({
			sessions: [
				makeChain({
					data: { id: 1, name: '検定A', mode: null, is_tournament_mode: false },
					error: null
				})
			],
			participants: [makeChain({ data: [], error: null })]
		});

		const res = await GET(makeEvent(supabase));
		const body = await res.json();

		expect(body.mode).toBe('certification');
		expect(body.training_events).toHaveLength(0);
		expect(body.custom_events).toHaveLength(0);
	});

	it('participants 取得エラーは 500', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(authenticateAction).mockResolvedValueOnce({ user: { id: 'u1' } } as any);
		const supabase = makeSupabase({
			sessions: [
				makeChain({
					data: { id: 1, name: '検定A', mode: null, is_tournament_mode: false },
					error: null
				})
			],
			participants: [makeChain({ data: null, error: { message: 'boom' } })]
		});

		await expect(GET(makeEvent(supabase))).rejects.toMatchObject({ status: 500 });
	});
});
