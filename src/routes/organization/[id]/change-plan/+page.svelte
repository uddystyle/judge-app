<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import NavButton from '$lib/components/NavButton.svelte';
	import type { PageData, ActionData } from './$types';

	export let data: PageData;
	export let form: ActionData;

	let selectedPlan: 'basic' | 'standard' | 'premium' | null = null;
	let billingInterval: 'month' | 'year' = (data.subscription.billing_interval as 'month' | 'year') || 'month';
	let loading = false;

	const plans = {
		basic: {
			name: 'Basic',
			maxMembers: 10,
			maxJudges: 15,
			monthlyPrice: 8800,
			yearlyPrice: 88000,
			features: ['組織メンバー10名まで', '検定員15名まで', 'セッション無制限', '基本機能すべて利用可能']
		},
		standard: {
			name: 'Standard',
			maxMembers: 30,
			maxJudges: 50,
			monthlyPrice: 24800,
			yearlyPrice: 248000,
			features: ['組織メンバー30名まで', '検定員50名まで', 'セッション無制限', '基本機能すべて利用可能']
		},
		premium: {
			name: 'Premium',
			maxMembers: 100,
			maxJudges: 100,
			monthlyPrice: 49800,
			yearlyPrice: 498000,
			features: ['組織メンバー100名まで', '検定員100名まで', 'セッション無制限', '基本機能すべて利用可能']
		}
	};

	function getPrice(plan: 'basic' | 'standard' | 'premium') {
		return billingInterval === 'month' ? plans[plan].monthlyPrice : plans[plan].yearlyPrice;
	}

	function formatPrice(price: number) {
		return new Intl.NumberFormat('ja-JP', {
			style: 'currency',
			currency: 'JPY'
		}).format(price);
	}

	function isPlanUpgrade(newPlan: 'basic' | 'standard' | 'premium'): boolean {
		const planHierarchy: Record<string, number> = {
			basic: 1,
			standard: 2,
			premium: 3
		};
		return planHierarchy[newPlan] > planHierarchy[data.organization.plan_type];
	}

	function getChangeType(newPlan: 'basic' | 'standard' | 'premium'): 'upgrade' | 'downgrade' | 'same' {
		if (newPlan === data.organization.plan_type) return 'same';
		return isPlanUpgrade(newPlan) ? 'upgrade' : 'downgrade';
	}

	$: changeType = selectedPlan ? getChangeType(selectedPlan) : null;
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="container">
	<div class="page-header">
		<h1 class="page-title">プラン変更</h1>
		<p class="page-subtitle">組織: {data.organization.name}</p>
	</div>

	<div class="current-plan-section">
		<h2 class="section-title">現在のプラン</h2>
		<div class="current-plan-card">
			<div class="plan-badge current">{plans[data.organization.plan_type as keyof typeof plans].name}</div>
			<p class="plan-price">
				{formatPrice(getPrice(data.organization.plan_type as 'basic' | 'standard' | 'premium'))} / {billingInterval === 'month' ? '月' : '年'}
			</p>
		</div>
	</div>

	{#if form?.error}
		<div class="error-container">
			<p class="error-message">{form.error}</p>
		</div>
	{/if}

	{#if changeType === 'upgrade'}
		<div class="info-box upgrade">
			<div class="info-icon">⬆️</div>
			<div class="info-content">
				<h3 class="info-title">アップグレード</h3>
				<p class="info-text">
					プラン変更後、すぐに新しいプランの機能が利用可能になります。既にお支払いいただいた金額との差額を日割り計算し、即座に請求いたします。
				</p>
			</div>
		</div>
	{:else if changeType === 'downgrade'}
		<div class="info-box downgrade">
			<div class="info-icon">⬇️</div>
			<div class="info-content">
				<h3 class="info-title">ダウングレード</h3>
				<p class="info-text">
					プラン変更は次回の請求日から適用されます。現在の請求期間終了まで、引き続き現在のプランの機能をご利用いただけます。
				</p>
			</div>
		</div>
	{/if}

	<form method="POST" action="?/changePlan" use:enhance={() => {
		loading = true;
		return async ({ update }) => {
			await update();
			loading = false;
		};
	}}>
		<input type="hidden" name="billingInterval" value={billingInterval} />
		<input type="hidden" name="planType" value={selectedPlan || ''} />

		<div class="billing-toggle">
			<button
				type="button"
				class="toggle-btn"
				class:active={billingInterval === 'month'}
				on:click={() => (billingInterval = 'month')}
			>
				月額
			</button>
			<button
				type="button"
				class="toggle-btn"
				class:active={billingInterval === 'year'}
				on:click={() => (billingInterval = 'year')}
			>
				年額
				<span class="discount-badge">2ヶ月分お得</span>
			</button>
		</div>

		<div class="plans-container">
			{#each Object.entries(plans) as [planKey, plan]}
				{@const isCurrentPlan = planKey === data.organization.plan_type}
				<div
					class="plan-card"
					class:selected={selectedPlan === planKey}
					class:current={isCurrentPlan}
					on:click={() => !isCurrentPlan && (selectedPlan = planKey as 'basic' | 'standard' | 'premium')}
					role="button"
					tabindex="0"
					on:keypress={(e) => e.key === 'Enter' && !isCurrentPlan && (selectedPlan = planKey as 'basic' | 'standard' | 'premium')}
				>
					{#if isCurrentPlan}
						<div class="plan-badge current">現在のプラン</div>
					{/if}
					<h3 class="plan-name">{plan.name}</h3>
					<p class="plan-price">{formatPrice(getPrice(planKey as 'basic' | 'standard' | 'premium'))}</p>
					<p class="plan-interval">/ {billingInterval === 'month' ? '月' : '年'}</p>
					<ul class="plan-features">
						{#each plan.features as feature}
							<li>{feature}</li>
						{/each}
					</ul>
					{#if !isCurrentPlan}
						<div class="select-indicator">
							{selectedPlan === planKey ? '✓ 選択中' : '選択する'}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<div class="action-buttons">
			<button
				type="submit"
				class="submit-btn"
				disabled={!selectedPlan || selectedPlan === data.organization.plan_type || loading}
			>
				{loading ? '処理中...' : 'プランを変更する'}
			</button>
			<NavButton on:click={() => goto('/pricing')}>
				キャンセル
			</NavButton>
		</div>
	</form>
</div>

<style>
	.container {
		padding: 28px 20px;
		max-width: 1200px;
		margin: 0 auto;
	}

	.page-header {
		text-align: center;
		margin-bottom: 32px;
	}

	.page-title {
		font-size: 28px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 8px;
	}

	.page-subtitle {
		font-size: 14px;
		color: var(--text-secondary);
	}

	.current-plan-section {
		margin-bottom: 32px;
	}

	.section-title {
		font-size: 18px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 12px;
		text-align: center;
	}

	.current-plan-card {
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		border-radius: 16px;
		padding: 20px;
		text-align: center;
		box-shadow: 0 4px 12px rgba(255, 107, 53, 0.2);
	}

	.plan-badge {
		display: inline-block;
		background: white;
		color: var(--accent-primary);
		font-size: 14px;
		font-weight: 700;
		padding: 6px 16px;
		border-radius: 20px;
		margin-bottom: 8px;
	}

	.plan-badge.current {
		background: var(--accent-primary);
		color: white;
	}

	.plan-price {
		font-size: 32px;
		font-weight: 700;
		color: white;
		margin: 0;
	}

	.error-container {
		background: #fee;
		border: 2px solid #dc3545;
		border-radius: 12px;
		padding: 16px;
		text-align: center;
		margin-bottom: 20px;
	}

	.error-message {
		color: #dc3545;
		font-size: 14px;
		margin: 0;
	}

	.info-box {
		border-radius: 16px;
		padding: 20px;
		margin-bottom: 24px;
		display: flex;
		gap: 16px;
		align-items: flex-start;
	}

	.info-box.upgrade {
		background: linear-gradient(135deg, #e6f7ff 0%, #cceeff 100%);
		border: 2px solid #1890ff;
	}

	.info-box.downgrade {
		background: linear-gradient(135deg, #fff7e6 0%, #ffe7ba 100%);
		border: 2px solid #fa8c16;
	}

	.info-icon {
		font-size: 32px;
		flex-shrink: 0;
	}

	.info-content {
		flex: 1;
	}

	.info-title {
		font-size: 16px;
		font-weight: 700;
		margin: 0 0 8px 0;
	}

	.info-box.upgrade .info-title {
		color: #1890ff;
	}

	.info-box.downgrade .info-title {
		color: #fa8c16;
	}

	.info-text {
		font-size: 14px;
		line-height: 1.6;
		margin: 0;
		color: var(--text-primary);
	}

	.billing-toggle {
		display: flex;
		gap: 12px;
		margin-bottom: 24px;
		justify-content: center;
	}

	.toggle-btn {
		background: var(--bg-primary);
		border: 2px solid var(--separator-gray);
		border-radius: 12px;
		padding: 12px 24px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.toggle-btn.active {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: white;
	}

	.discount-badge {
		font-size: 12px;
		background: var(--accent-secondary);
		color: white;
		padding: 2px 8px;
		border-radius: 8px;
	}

	.plans-container {
		display: grid;
		grid-template-columns: 1fr;
		gap: 20px;
		margin-bottom: 32px;
	}

	.plan-card {
		background: var(--bg-primary);
		border: 3px solid var(--separator-gray);
		border-radius: 16px;
		padding: 24px;
		text-align: center;
		cursor: pointer;
		transition: all 0.2s;
		position: relative;
	}

	.plan-card:hover:not(.current) {
		border-color: var(--accent-primary);
		box-shadow: 0 4px 16px rgba(255, 107, 53, 0.2);
		transform: translateY(-2px);
	}

	.plan-card.selected {
		border-color: var(--accent-primary);
		background: linear-gradient(135deg, #fff4e6 0%, #ffe8cc 100%);
	}

	.plan-card.current {
		border-color: var(--separator-gray);
		background: var(--bg-secondary);
		cursor: not-allowed;
		opacity: 0.7;
	}

	.plan-name {
		font-size: 24px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 12px 0;
	}

	.plan-interval {
		font-size: 14px;
		color: var(--text-secondary);
		margin: 0 0 16px 0;
	}

	.plan-features {
		list-style: none;
		padding: 0;
		margin: 20px 0;
		text-align: left;
	}

	.plan-features li {
		padding: 8px 0;
		padding-left: 24px;
		position: relative;
		font-size: 14px;
		color: var(--text-primary);
	}

	.plan-features li::before {
		content: '✓';
		position: absolute;
		left: 0;
		color: var(--accent-primary);
		font-weight: bold;
	}

	.select-indicator {
		margin-top: 16px;
		padding: 12px;
		background: var(--accent-primary);
		color: white;
		border-radius: 8px;
		font-weight: 600;
	}

	.plan-card:not(.selected) .select-indicator {
		background: var(--separator-gray);
		color: var(--text-primary);
	}

	.action-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.submit-btn {
		width: 100%;
		background: var(--accent-primary);
		color: white;
		border: none;
		border-radius: 12px;
		padding: 16px;
		font-size: 17px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.submit-btn:hover:not(:disabled) {
		background: var(--accent-secondary);
		box-shadow: 0 4px 16px rgba(255, 107, 53, 0.3);
	}

	.submit-btn:active:not(:disabled) {
		transform: scale(0.98);
	}

	.submit-btn:disabled {
		background: var(--separator-gray);
		cursor: not-allowed;
		opacity: 0.6;
	}

	/* PC対応 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
		}

		.page-title {
			font-size: 32px;
		}

		.plans-container {
			grid-template-columns: repeat(3, 1fr);
		}

		.action-buttons {
			flex-direction: row;
			justify-content: center;
		}

		.submit-btn {
			width: auto;
			min-width: 300px;
		}
	}
</style>
