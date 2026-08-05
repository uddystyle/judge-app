import { describe, it, expect, vi } from 'vitest';
import {
	claimInvitationUse,
	parseInvitationMaxUses,
	DEFAULT_INVITATION_MAX_USES
} from './invitations';

/**
 * 招待の使用回数（used_count）の確定。
 *
 * ⚠️ `used_count: invitation.used_count + 1` のような読んで足して書く形は、
 * 同時受諾で**両方が同じ値を書く**ため max_uses を守れない。
 * 「今読んだ値のままなら +1 する」条件付き UPDATE（CAS）にして、
 * 勝った1つだけが使用権を得るようにする。
 */

type Row = { id: string; used_count: number; max_uses: number | null };

/**
 * used_count に対する CAS を模した最小のテーブル。
 * update().eq('id').eq('used_count', expected) の形だけを解釈する。
 */
function createSupabase(row: Row, opts: { onUpdate?: () => void } = {}) {
	const state = { ...row };

	const client = {
		from: vi.fn(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const q: any = {};
			const filters: Record<string, unknown> = {};
			let payload: Record<string, unknown> = {};
			Object.assign(q, {
				select: vi.fn(() => q),
				update: vi.fn((v: Record<string, unknown>) => {
					payload = v;
					return q;
				}),
				eq: vi.fn((col: string, val: unknown) => {
					filters[col] = val;
					return q;
				}),
				then: (resolve: (v: unknown) => unknown) => {
					// 他の受諾が先に進むタイミングを差し込めるようにする
					opts.onUpdate?.();
					const matches =
						filters.id === state.id &&
						(filters.used_count === undefined || filters.used_count === state.used_count);
					if (matches) {
						state.used_count = payload.used_count as number;
						return Promise.resolve({ data: [{ id: state.id }], error: null }).then(resolve);
					}
					return Promise.resolve({ data: [], error: null }).then(resolve);
				}
			});
			return q;
		})
	};

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { client: client as any, state };
}

describe('claimInvitationUse', () => {
	it('上限に達していなければ使用権を得て used_count を1つ進める', async () => {
		const { client, state } = createSupabase({ id: 'inv-1', used_count: 0, max_uses: 1 });

		const result = await claimInvitationUse(client, { id: 'inv-1', used_count: 0, max_uses: 1 });

		expect(result.claimed).toBe(true);
		expect(state.used_count).toBe(1);
	});

	it('同時受諾では1つしか使用権を得られない（max_uses=1 を守る）', async () => {
		// A が読んだあと、A が書く直前に B が先に書き切る状況を作る
		let raced = false;
		const shared = { id: 'inv-1', used_count: 0, max_uses: 1 };
		const { client, state } = createSupabase(shared, {
			onUpdate: () => {
				if (raced) return;
				raced = true;
				// B が先に確定した（used_count が 0 → 1 に進む）
				state.used_count = 1;
			}
		});

		// A は used_count=0 を読んだ状態で確定しにいく
		const result = await claimInvitationUse(client, { id: 'inv-1', used_count: 0, max_uses: 1 });

		expect(result.claimed).toBe(false);
		expect(state.used_count).toBe(1); // 2 にはならない
	});

	it('max_uses が null（無制限）なら常に使用権を得られる', async () => {
		const { client, state } = createSupabase({ id: 'inv-1', used_count: 41, max_uses: null });

		const result = await claimInvitationUse(client, {
			id: 'inv-1',
			used_count: 41,
			max_uses: null
		});

		expect(result.claimed).toBe(true);
		expect(state.used_count).toBe(42);
	});

	it('既に上限に達していれば使用権を得られない', async () => {
		const { client, state } = createSupabase({ id: 'inv-1', used_count: 1, max_uses: 1 });

		const result = await claimInvitationUse(client, { id: 'inv-1', used_count: 1, max_uses: 1 });

		expect(result.claimed).toBe(false);
		expect(state.used_count).toBe(1);
	});
});

describe('parseInvitationMaxUses', () => {
	it('未指定は無制限（null）。1リンクを配って全員に参加してもらう運用が既定', () => {
		expect(DEFAULT_INVITATION_MAX_USES).toBeNull();
		expect(parseInvitationMaxUses(undefined)).toBeNull();
		expect(parseInvitationMaxUses(null)).toBeNull();
	});

	it('数値を指定すればその回数に制限できる', () => {
		expect(parseInvitationMaxUses(5)).toBe(5);
	});

	it('範囲外は拒否する', () => {
		expect(() => parseInvitationMaxUses(0)).toThrow();
		expect(() => parseInvitationMaxUses(101)).toThrow();
		expect(() => parseInvitationMaxUses(1.5)).toThrow();
	});
});
