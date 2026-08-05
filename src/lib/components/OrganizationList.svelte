<script lang="ts">
	// アカウント（プロフィール）ページで「自分がどの組織に所属しているか」を示す一覧。
	//
	// ⚠️ 以前はこのセクションが存在せず、account/+page.svelte には getPlanName /
	// getUsageText などの関数だけが未使用のまま残っていた（セクション削除時の取り残し）。
	// ユーザーは自分の所属組織をアカウント画面から確認できない状態だった。

	interface PlanLimits {
		max_organization_members?: number;
		max_sessions_per_month?: number;
	}
	interface CurrentUsage {
		members_count?: number;
		sessions_count?: number;
	}
	interface OrganizationSummary {
		id: string;
		name: string;
		plan_type: string;
		userRole?: string;
		planLimits?: PlanLimits | null;
		currentUsage?: CurrentUsage | null;
	}

	export let organizations: OrganizationSummary[] = [];

	const PLAN_NAMES: Record<string, string> = {
		free: 'フリー',
		basic: 'Basic',
		standard: 'Standard',
		premium: 'Premium'
	};

	function planName(planType: string): string {
		return PLAN_NAMES[planType] ?? PLAN_NAMES.free;
	}

	function roleLabel(role: string | undefined): string {
		return role === 'admin' ? '管理者' : 'メンバー';
	}

	/** `-1` は無制限を表す（plan_limits の規約） */
	function usageText(count: number | undefined, limit: number | undefined, unit: string): string {
		const used = count ?? 0;
		if (limit === undefined || limit === null) return `${used} ${unit}`;
		if (limit === -1) return `${used} ${unit}`;
		return `${used} / ${limit} ${unit}`;
	}
</script>

<div class="org-list">
	{#if organizations.length === 0}
		<p class="empty">所属している組織はありません。組織を作成するか、招待から参加してください。</p>
	{:else}
		{#each organizations as org (org.id)}
			<a class="org-card" href="/organization/{org.id}">
				<div class="org-head">
					<span class="org-name">{org.name}</span>
					<span class="role" class:admin={org.userRole === 'admin'}>
						{roleLabel(org.userRole)}
					</span>
				</div>
				<div class="org-meta">
					<span class="plan">{planName(org.plan_type)}</span>
					<span class="usage">
						{usageText(
							org.currentUsage?.members_count,
							org.planLimits?.max_organization_members,
							'人'
						)}
					</span>
				</div>
			</a>
		{/each}
	{/if}
</div>

<style>
	.org-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
		text-align: left;
	}
	.empty {
		color: var(--text-secondary);
		font-size: 14px;
		line-height: 1.6;
		margin: 0;
	}
	.org-card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px 16px;
		border: 2px solid var(--separator-gray);
		border-radius: 12px;
		background: white;
		text-decoration: none;
		color: inherit;
	}
	.org-card:hover {
		border-color: var(--accent, var(--text-secondary));
	}
	.org-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.org-name {
		font-size: 15px;
		font-weight: 600;
		color: var(--text-primary);
		word-break: break-word;
	}
	.role {
		flex-shrink: 0;
		padding: 2px 10px;
		border-radius: 999px;
		background: var(--bg-secondary);
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
	}
	.role.admin {
		background: var(--accent-tint);
		color: var(--accent);
	}
	.org-meta {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.plan {
		font-weight: 600;
	}
</style>
