import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 課金状態の可視化（監査後の追加対応）
 *
 * ⚠️ 背景: これまで UI は plan_type しか出しておらず、`status` を表示する画面が
 * 1つも無かった。そのため「支払われている premium」と「支払いが滞っている premium」を
 * ユーザーが区別できない。past_due はアプリ側では上位プランの権限を維持する猶予期間
 * （ENTITLED_STATUSES）として扱うため、当人は気づかないまま使い続け、
 * 猶予が切れた瞬間に free へ落ちてメンバーが締め出される。
 *
 * subscriptions の SELECT ポリシーは `auth.uid() = user_id` なので、契約者本人以外の
 * 管理者はユーザークライアントでは読めない。role を確認したうえで service role で引く。
 */

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() }
}));

const { mockGetActiveOrgRole } = vi.hoisted(() => ({ mockGetActiveOrgRole: vi.fn() }));
vi.mock('$lib/server/orgAuth', () => ({
	getActiveOrgRole: mockGetActiveOrgRole,
	isOrgAdmin: vi.fn(async () => true)
}));
vi.mock('$lib/server/validation', () => ({ validateOrganizationName: vi.fn() }));

import { load } from './+page.server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(result: any) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const c: any = {};
	for (const m of [
		'select',
		'eq',
		'in',
		'is',
		'or',
		'order',
		'limit',
		'neq',
		'gte',
		'gt',
		'lt',
		'lte',
		'not'
	]) {
		c[m] = vi.fn(() => c);
	}
	c.single = vi.fn(async () => result);
	c.maybeSingle = vi.fn(async () => result);
	c.then = (r: (v: unknown) => unknown) => Promise.resolve(result).then(r);
	return c;
}

const ORG = { id: 'org-1', name: 'テスト組織', plan_type: 'premium', max_members: 100 };

function makeSupabase() {
	return {
		auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) },
		from: vi.fn((table: string) => {
			if (table === 'organizations') return chain({ data: ORG, error: null });
			if (table === 'organization_members') return chain({ data: [], error: null });
			if (table === 'profiles') return chain({ data: [], error: null });
			return chain({ data: [], error: null });
		})
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeAdminClient(row: any) {
	return { from: vi.fn(() => chain({ data: row, error: null })) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeEvent = (supabaseAdmin: any) =>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	({ params: { id: 'org-1' }, locals: { supabase: makeSupabase(), supabaseAdmin } }) as any;

describe('organization/[id] load の課金状態', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetActiveOrgRole.mockResolvedValue('admin');
	});

	it('管理者には支払い状態と解約予定を返す', async () => {
		const admin = makeAdminClient({
			status: 'past_due',
			cancel_at_period_end: false,
			current_period_end: '2026-09-02T00:00:00Z'
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await load(makeEvent(admin));

		expect(result.billing).toMatchObject({
			status: 'past_due',
			cancelAtPeriodEnd: false,
			currentPeriodEnd: '2026-09-02T00:00:00Z'
		});
	});

	it('一般メンバーには渡さない（支払い方法を直せる立場にない）', async () => {
		mockGetActiveOrgRole.mockResolvedValue('member');
		const admin = makeAdminClient({
			status: 'past_due',
			cancel_at_period_end: false,
			current_period_end: '2026-09-02T00:00:00Z'
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await load(makeEvent(admin));

		expect(result.billing).toBeNull();
	});

	it('サブスクリプションが無い組織（free）は null', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await load(makeEvent(makeAdminClient(null)));

		expect(result.billing).toBeNull();
	});

	it('supabaseAdmin 未設定でもページは壊れない', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await load(makeEvent(undefined));

		expect(result.billing).toBeNull();
		expect(result.organization.plan_type).toBe('premium');
	});
});

/**
 * 組織に複数の subscriptions 行がある状況（過去の解約済み + 現在の契約）でも壊れないこと。
 *
 * ⚠️ H-1 と同じ罠。PostgREST の maybeSingle() は**複数行でもエラー**になるため、
 * 「1組織 = 1行」を前提にすると、再契約して履歴が増えた瞬間にバッジが黙って消える。
 */
describe('subscriptions が複数行ある組織', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetActiveOrgRole.mockResolvedValue('admin');
	});

	it('複数行でも最新の1件を採用する（黙って消えない）', async () => {
		// 新しい順に並べた1件だけが返る想定のモック
		const admin = {
			from: vi.fn(() =>
				chain({
					data: {
						status: 'past_due',
						cancel_at_period_end: false,
						current_period_end: '2026-09-02T00:00:00Z'
					},
					error: null
				})
			)
		};

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result: any = await load(makeEvent(admin));

		expect(result.billing).toMatchObject({ status: 'past_due' });
		// 単一行を前提にせず、新しい順に絞り込んでから取得していること
		const builder = admin.from.mock.results[0].value;
		expect(builder.order).toHaveBeenCalled();
		expect(builder.limit).toHaveBeenCalledWith(1);
	});
});
