import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * session/create の create アクション: 大会モードのチケット制ゲートのテスト
 *
 * 大会モードはプラン特典ではなくチケット（スポット販売）制:
 * - チケット残 0 → 403 + お問い合わせ導線（upgradeUrl ではなく contactUrl）
 * - チケットあり → 月間セッション上限チェックをスキップして作成
 * - insert 時の DB トリガー拒否（レース）→ 403 + お問い合わせ導線
 */

vi.mock('$lib/server/rateLimit', () => ({
	rateLimiters: undefined,
	checkRateLimit: vi.fn(async () => ({ success: true }))
}));

vi.mock('$lib/server/organizationLimits', () => ({
	checkCanCreateSession: vi.fn(async () => ({ allowed: true })),
	checkCanUseTrainingMode: vi.fn(async () => ({ allowed: true }))
}));

vi.mock('$lib/server/tournamentTickets', async (importOriginal) => {
	const mod = await importOriginal<typeof import('$lib/server/tournamentTickets')>();
	return { ...mod, countAvailableTickets: vi.fn(async () => 0) };
});

import { actions } from './+page.server';
import { checkCanCreateSession } from '$lib/server/organizationLimits';
import { countAvailableTickets } from '$lib/server/tournamentTickets';

const ORG_ID = '123e4567-e89b-12d3-a456-426614174000';

/** チェーン可能なクエリモック */
function makeChain(result: unknown = { data: null, error: null }) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const c: any = {};
	for (const m of ['select', 'eq', 'is', 'insert', 'gte', 'neq', 'order', 'limit']) {
		c[m] = vi.fn(() => c);
	}
	c.single = vi.fn(async () => result);
	c.maybeSingle = vi.fn(async () => result);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	c.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
	return c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSupabase(queues: Record<string, any[]>) {
	return {
		auth: {
			getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }))
		},
		from: vi.fn((table: string) => {
			const q = queues[table];
			if (!q || q.length === 0) throw new Error(`unexpected from(${table})`);
			return q.length > 1 ? q.shift() : q[0];
		})
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeEvent = (supabase: any, formValues: Record<string, any>) =>
	({
		request: {
			formData: async () => ({
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				get: (key: string) => formValues[key] as any
			})
		},
		locals: { supabase }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any;

const baseForm = {
	sessionName: 'テスト大会',
	mode: 'tournament',
	organizationId: ORG_ID
};

const membershipChain = () => makeChain({ data: { organization_id: ORG_ID }, error: null });

beforeEach(() => {
	vi.clearAllMocks();
});

describe('create アクション - 大会モード（チケット制）', () => {
	it('チケット残 0 なら 403 + お問い合わせ導線を返し、セッションを作成しない', async () => {
		vi.mocked(countAvailableTickets).mockResolvedValue(0);
		const supabase = makeSupabase({
			organization_members: [membershipChain()]
		});

		const result = await actions.create(makeEvent(supabase, baseForm));

		expect(result).toMatchObject({
			status: 403,
			data: {
				error: expect.stringContaining('お問い合わせ'),
				contactUrl: '/contact?category=tournament_quote'
			}
		});
		// upgradeUrl（プランアップグレード誘導）は返さない
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((result as any).data.upgradeUrl).toBeUndefined();
		// sessions テーブルへは一切アクセスしない（join code 生成にも到達しない）
		expect(supabase.from).not.toHaveBeenCalledWith('sessions');
	});

	it('チケットがあれば月間上限チェックをスキップして大会セッションを作成する', async () => {
		vi.mocked(countAvailableTickets).mockResolvedValue(1);
		const joinCodeCheck = makeChain({ data: null, error: null });
		const insert = makeChain({ data: { id: 42 }, error: null });
		const supabase = makeSupabase({
			organization_members: [membershipChain()],
			sessions: [joinCodeCheck, insert],
			session_participants: [makeChain({ error: null })]
		});

		await expect(actions.create(makeEvent(supabase, baseForm))).rejects.toMatchObject({
			status: 303,
			location: '/session/42/tournament-setup'
		});

		// 大会はチケットで対価を得ているため月間セッション上限の対象外
		expect(checkCanCreateSession).not.toHaveBeenCalled();
		expect(insert.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: 'tournament',
				is_tournament_mode: true,
				organization_id: ORG_ID
			})
		);
	});

	it('insert が DB トリガーに拒否されたら（同時消費レース）403 + お問い合わせ導線', async () => {
		vi.mocked(countAvailableTickets).mockResolvedValue(1);
		const joinCodeCheck = makeChain({ data: null, error: null });
		const insert = makeChain({
			data: null,
			error: { message: 'TOURNAMENT_TICKET_REQUIRED: 大会モードの利用には大会チケットが必要です' }
		});
		const supabase = makeSupabase({
			organization_members: [membershipChain()],
			sessions: [joinCodeCheck, insert]
		});

		const result = await actions.create(makeEvent(supabase, baseForm));

		expect(result).toMatchObject({
			status: 403,
			data: {
				contactUrl: '/contact?category=tournament_quote'
			}
		});
	});

	it('検定モードは従来どおり月間セッション上限チェックを通る', async () => {
		const joinCodeCheck = makeChain({ data: null, error: null });
		const insert = makeChain({ data: { id: 43 }, error: null });
		const supabase = makeSupabase({
			organization_members: [membershipChain()],
			sessions: [joinCodeCheck, insert],
			session_participants: [makeChain({ error: null })]
		});

		await expect(
			actions.create(makeEvent(supabase, { ...baseForm, mode: 'kentei' }))
		).rejects.toMatchObject({ status: 303, location: '/dashboard' });

		expect(checkCanCreateSession).toHaveBeenCalledWith(supabase, ORG_ID);
		expect(countAvailableTickets).not.toHaveBeenCalled();
	});
});
