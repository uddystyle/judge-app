<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { goto } from '$app/navigation';

	export let data: PageData;

	function formatDate(dateString: string): string {
		const date = new Date(dateString);
		return date.toLocaleDateString('ja-JP', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} hasOrganization={data.organizations && data.organizations.length > 0} pageOrganizations={data.organizations || []} />

<div class="container">
	<div class="instruction">組織</div>

	{#if !data.organizations || data.organizations.length === 0}
		<!-- 組織未作成の場合 -->
		<div class="no-organization-card">
			<div class="warning-icon">⚠️</div>
			<h3 class="warning-title">組織が作成されていません</h3>
			<p class="warning-message">
				TENTOでは、すべてのセッションは組織に属します。<br />
				まずは組織を作成してください。
			</p>
			<div class="actions">
				<NavButton variant="primary" on:click={() => goto('/onboarding/create-organization')}>
					組織を作成する
				</NavButton>
			</div>
		</div>
	{:else}
		<!-- 複数組織を表示 -->
		{#each data.organizations as org}
			<div class="organization-card">
				<div class="organization-info">
					<h3 class="org-name">{org.name}</h3>
					<div class="org-details">
						<span class="org-role" class:admin={org.userRole === 'admin'}>
							{org.userRole === 'admin' ? '管理者' : 'メンバー'}
						</span>
						<span class="org-date">作成日: {formatDate(org.created_at)}</span>
					</div>
				</div>

				<div class="actions">
					<NavButton on:click={() => goto(`/organization/${org.id}`)}>
						組織詳細を見る
					</NavButton>
				</div>
			</div>
		{/each}

		<!-- 新しい組織を作成 -->
		<div class="create-org-card">
			<p class="create-org-text">複数の組織を作成・管理できます</p>
			<NavButton variant="primary" on:click={() => goto('/onboarding/create-organization')}>
				新しい組織を作成
			</NavButton>
		</div>
	{/if}
</div>

<Footer />

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 600px;
		margin: 0 auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 32px;
		letter-spacing: -0.01em;
	}
	.no-organization-card {
		background: var(--bg-secondary);
		border: 2px solid var(--border-medium);
		border-radius: 12px;
		padding: 32px 24px;
		text-align: center;
	}
	.warning-icon {
		font-size: 48px;
		margin-bottom: 16px;
	}
	.warning-title {
		font-size: 20px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 12px;
		letter-spacing: -0.01em;
	}
	.warning-message {
		font-size: 15px;
		color: var(--text-secondary);
		line-height: 1.7;
		margin-bottom: 24px;
		letter-spacing: -0.01em;
	}
	.organization-card {
		background: var(--bg-primary);
		border: 1px solid var(--border-light);
		border-radius: 12px;
		padding: 24px;
		margin-bottom: 16px;
		text-align: left;
	}
	.organization-info {
		margin-bottom: 20px;
	}
	.org-name {
		font-size: 20px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 12px;
		letter-spacing: -0.01em;
	}
	.org-details {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.org-role {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-secondary);
		padding: 4px 12px;
		background: var(--bg-secondary);
		border-radius: 6px;
		align-self: flex-start;
		letter-spacing: -0.01em;
	}
	.org-role.admin {
		background: var(--accent-primary);
		color: white;
	}
	.org-date {
		font-size: 14px;
		color: var(--text-secondary);
		letter-spacing: -0.01em;
	}
	.actions {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.create-org-card {
		background: var(--bg-secondary);
		border: 1px dashed var(--border-medium);
		border-radius: 12px;
		padding: 24px;
		text-align: center;
		margin-top: 24px;
	}
	.create-org-text {
		font-size: 15px;
		color: var(--text-secondary);
		margin-bottom: 16px;
		letter-spacing: -0.01em;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 800px;
		}
		.instruction {
			font-size: 32px;
			margin-bottom: 40px;
		}
		.no-organization-card {
			padding: 40px 32px;
		}
		.warning-icon {
			font-size: 64px;
			margin-bottom: 20px;
		}
		.warning-title {
			font-size: 24px;
			margin-bottom: 16px;
		}
		.warning-message {
			font-size: 16px;
			margin-bottom: 32px;
		}
		.organization-card {
			padding: 32px;
			margin-bottom: 20px;
		}
		.org-name {
			font-size: 24px;
			margin-bottom: 16px;
		}
		.org-details {
			flex-direction: row;
			align-items: center;
			gap: 16px;
		}
		.create-org-card {
			padding: 32px;
		}
	}
</style>
