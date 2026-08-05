import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import OrganizationList from './OrganizationList.svelte';

/**
 * プロフィール（アカウント）ページで「自分がどの組織に所属しているか」を示す一覧。
 *
 * ⚠️ 以前はこのセクションが存在せず、account/+page.svelte には
 * getPlanName / getUsageText などの関数だけが未使用のまま残っていた
 * （セクションが削除された際の取り残し）。ユーザーは自分の所属組織を
 * アカウント画面から確認できない状態だった。
 */

const ORG = {
	id: 'org-1',
	name: 'テスト組織',
	plan_type: 'premium',
	userRole: 'admin',
	planLimits: { max_organization_members: 100, max_sessions_per_month: 50 },
	currentUsage: { members_count: 11, sessions_count: 3 }
};

describe('OrganizationList', () => {
	it('所属している組織名を表示する', () => {
		render(OrganizationList, { organizations: [ORG] });
		expect(screen.getByText('テスト組織')).toBeTruthy();
	});

	it('複数の組織をすべて表示する', () => {
		render(OrganizationList, {
			organizations: [ORG, { ...ORG, id: 'org-2', name: '第二組織', userRole: 'member' }]
		});
		expect(screen.getByText('テスト組織')).toBeTruthy();
		expect(screen.getByText('第二組織')).toBeTruthy();
	});

	it('プラン名を表示する', () => {
		render(OrganizationList, { organizations: [ORG] });
		expect(screen.getByText('Premium')).toBeTruthy();
	});

	it('自分の役割（管理者 / メンバー）を表示する', () => {
		render(OrganizationList, {
			organizations: [ORG, { ...ORG, id: 'org-2', name: '第二組織', userRole: 'member' }]
		});
		expect(screen.getByText('管理者')).toBeTruthy();
		expect(screen.getByText('メンバー')).toBeTruthy();
	});

	it('メンバー数と上限を表示する', () => {
		render(OrganizationList, { organizations: [ORG] });
		expect(screen.getByText('11 / 100 人')).toBeTruthy();
	});

	it('上限が -1 の場合は無制限として表示する', () => {
		render(OrganizationList, {
			organizations: [
				{
					...ORG,
					planLimits: { max_organization_members: -1, max_sessions_per_month: -1 }
				}
			]
		});
		expect(screen.getByText('11 人')).toBeTruthy();
	});

	it('組織ページへのリンクを持つ', () => {
		render(OrganizationList, { organizations: [ORG] });
		const link = screen.getByRole('link', { name: /テスト組織/ });
		expect(link.getAttribute('href')).toBe('/organization/org-1');
	});

	it('所属組織が無い場合は案内を表示する', () => {
		render(OrganizationList, { organizations: [] });
		expect(screen.getByText(/所属している組織はありません/)).toBeTruthy();
	});

	it('planLimits が欠けていても壊れない', () => {
		render(OrganizationList, {
			organizations: [{ ...ORG, planLimits: null, currentUsage: null }]
		});
		expect(screen.getByText('テスト組織')).toBeTruthy();
	});
});
