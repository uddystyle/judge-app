import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import BillingStatusBadge from './BillingStatusBadge.svelte';

/**
 * 表示ポリシー: 正常時（active / trialing かつ解約予定なし）は何も出さない。
 * 対処が必要なときだけ出す（SyncStatusBadge と同じ方針）。
 */
describe('BillingStatusBadge', () => {
	const base = { status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: null };

	it('正常時は何も表示しない', () => {
		const { container } = render(BillingStatusBadge, { billing: base });
		expect(container.querySelector('.billing-status')).toBeNull();
	});

	it('trialing も正常なので何も表示しない', () => {
		const { container } = render(BillingStatusBadge, {
			billing: { ...base, status: 'trialing' }
		});
		expect(container.querySelector('.billing-status')).toBeNull();
	});

	it('billing が無い（フリープラン）ときも何も表示しない', () => {
		const { container } = render(BillingStatusBadge, { billing: null });
		expect(container.querySelector('.billing-status')).toBeNull();
	});

	it('past_due は支払い確認を促す（猶予中に気づけるようにする）', () => {
		render(BillingStatusBadge, { billing: { ...base, status: 'past_due' } });
		expect(screen.getByText('お支払いの確認ができません')).toBeTruthy();
	});

	it('unpaid も支払い確認を促す', () => {
		render(BillingStatusBadge, { billing: { ...base, status: 'unpaid' } });
		expect(screen.getByText('お支払いが完了していません')).toBeTruthy();
	});

	it('incomplete は決済未確定として表示する', () => {
		render(BillingStatusBadge, { billing: { ...base, status: 'incomplete' } });
		expect(screen.getByText('お手続きが完了していません')).toBeTruthy();
	});

	it('解約予定は期限つきで表示する', () => {
		render(BillingStatusBadge, {
			billing: {
				status: 'active',
				cancelAtPeriodEnd: true,
				currentPeriodEnd: '2026-09-02T00:00:00Z'
			}
		});
		expect(screen.getByText('解約予定')).toBeTruthy();
		expect(screen.getByText(/2026年9月2日まではこのままご利用いただけます/)).toBeTruthy();
	});

	it('canceled は既に free へ降格済みなので表示しない', () => {
		const { container } = render(BillingStatusBadge, {
			billing: { ...base, status: 'canceled' }
		});
		expect(container.querySelector('.billing-status')).toBeNull();
	});

	it('onManage が無ければ操作ボタンを出さない（一般メンバー向け）', () => {
		const { container } = render(BillingStatusBadge, {
			billing: { ...base, status: 'past_due' },
			onManage: null
		});
		expect(container.querySelector('.manage')).toBeNull();
	});

	it('onManage があれば支払い方法の導線を出す', () => {
		render(BillingStatusBadge, {
			billing: { ...base, status: 'past_due' },
			onManage: () => {}
		});
		expect(screen.getByRole('button', { name: 'お支払い方法を確認' })).toBeTruthy();
	});
});
