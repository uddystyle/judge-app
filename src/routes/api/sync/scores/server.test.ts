import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/rateLimit', () => ({
	rateLimiters: undefined,
	checkRateLimit: vi.fn(async () => ({ success: true }))
}));

vi.mock('$lib/server/scoreSync', async (importOriginal) => {
	const mod = await importOriginal<typeof import('$lib/server/scoreSync')>();
	return { ...mod, processScoreMutation: vi.fn() };
});

import { POST } from './+server';
import { processScoreMutation } from '$lib/server/scoreSync';

const ID_A = '123e4567-e89b-12d3-a456-426614174000';
const ID_B = '223e4567-e89b-12d3-a456-426614174000';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeEvent = (body: unknown, locals: Record<string, any> = {}) =>
	({
		request: new Request('http://localhost/api/sync/scores', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		locals: { supabase: {}, supabaseAdmin: {}, ...locals }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/sync/scores', () => {
	it('mutations 配列が無ければ 400', async () => {
		const res = await POST(makeEvent({}));
		expect(res.status).toBe(400);
	});

	it('51件以上は 400', async () => {
		const res = await POST(
			makeEvent({ mutations: Array.from({ length: 51 }, () => ({ client_mutation_id: ID_A })) })
		);
		expect(res.status).toBe(400);
	});

	it('supabaseAdmin 未設定なら 500', async () => {
		const res = await POST(makeEvent({ mutations: [{}] }, { supabaseAdmin: undefined }));
		expect(res.status).toBe(500);
	});

	it('件別の結果を accepted / rejected に振り分けて返す', async () => {
		vi.mocked(processScoreMutation)
			.mockResolvedValueOnce({ accepted: true })
			.mockResolvedValueOnce({ accepted: false, reason: 'mode_mismatch' });

		const res = await POST(
			makeEvent({
				mutations: [{ client_mutation_id: ID_A }, { client_mutation_id: ID_B }]
			})
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			accepted: [ID_A],
			rejected: [{ client_mutation_id: ID_B, reason: 'mode_mismatch' }]
		});
		expect(processScoreMutation).toHaveBeenCalledTimes(2);
	});
});
