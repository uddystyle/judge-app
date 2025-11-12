<script lang="ts">
	import { enhance } from '$app/forms';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import type { PageData, ActionData } from './$types';

	export let data: PageData;
	export let form: ActionData;

	let selectedPlan: 'basic' | 'standard' | 'premium' | null = null;
	let billingInterval: 'month' | 'year' = (data.subscription?.billing_interval as 'month' | 'year') || 'month';
	let loading = false;

	// フリープランかどうか
	$: isFree = data.organization.plan_type === 'free';

	// 現在のサブスクリプションの請求間隔（実際に決済した間隔）
	const currentBillingInterval = (data.subscription?.billing_interval as 'month' | 'year') || 'month';

	const plans = {
		basic: {
			name: 'Basic',
			maxMembers: 10,
			maxJudges: 15,
			monthlyPrice: 8800,
			yearlyPrice: 70000,
			features: ['組織メンバー10名まで', '検定員15名まで', 'セッション無制限', '検定・大会・研修モード']
		},
		standard: {
			name: 'Standard',
			maxMembers: 30,
			maxJudges: 50,
			monthlyPrice: 24800,
			yearlyPrice: 180000,
			features: ['組織メンバー30名まで', '検定員50名まで', 'セッション無制限', '検定・大会・研修モード']
		},
		premium: {
			name: 'Premium',
			maxMembers: 100,
			maxJudges: 100,
			monthlyPrice: 49800,
			yearlyPrice: 300000,
			features: ['組織メンバー100名まで', '検定員100名まで', 'セッション無制限', '検定・大会・研修モード']
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

	// 割引率を計算
	function getDiscountRate(plan: 'basic' | 'standard' | 'premium'): number {
		const monthly = plans[plan].monthlyPrice;
		const yearly = plans[plan].yearlyPrice;
		return Math.round((1 - yearly / (monthly * 12)) * 100);
	}

	// 現在と同じプラン＆同じ請求間隔かどうか
	$: isSamePlanAndInterval = selectedPlan === data.organization.plan_type && billingInterval === currentBillingInterval;

	$: changeType = selectedPlan ? getChangeType(selectedPlan) : null;
</script>

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} hasOrganization={true} pageOrganizations={[data.organization]} />

<div class="container">
	<div class="page-header">
		<h1 class="page-title">プラン変更</h1>
		<p class="page-subtitle">組織: {data.organization.name}</p>
	</div>

	<div class="current-plan-section">
		<h2 class="section-title">現在のプラン</h2>
		<div class="current-plan-card" class:free={isFree}>
			{#if isFree}
				<div class="plan-badge current">フリー</div>
				<p class="current-price">無料</p>
			{:else}
				{@const currentPlan = plans[data.organization.plan_type as keyof typeof plans]}
				{@const currentPrice = currentBillingInterval === 'month' ? currentPlan.monthlyPrice : currentPlan.yearlyPrice}
				<div class="plan-badge current">{currentPlan.name}</div>
				<p class="current-price">
					{formatPrice(currentPrice)} / {currentBillingInterval === 'month' ? '月' : '年'}
				</p>
			{/if}
		</div>
	</div>

	{#if form?.error}
		<div class="error-container">
			<p class="error-message">{form.error}</p>
		</div>
	{/if}

	{#if isFree && selectedPlan}
		<div class="info-box upgrade">
			<div class="info-icon">⬆️</div>
			<div class="info-content">
				<h3 class="info-title">有料プランへアップグレード</h3>
				<p class="info-text">
					有料プランを選択すると、Stripe決済ページへ移動します。決済完了後、すぐに新しいプランの機能が利用可能になります。
				</p>
			</div>
		</div>
	{:else if selectedPlan !== data.organization.plan_type && billingInterval !== currentBillingInterval}
		<div class="info-box upgrade">
			<div class="info-content">
				<h3 class="info-title">プランと請求間隔の変更</h3>
				<p class="info-text">
					{#if changeType === 'upgrade'}
						プランのアップグレード
						{#if billingInterval === 'year'}
							と月額から年額への変更です。既にお支払いいただいた金額との差額を日割り計算し、即座に請求いたします。年額プランでは最大50%の割引が適用されます。
						{:else}
							と年額から月額への変更です。プランのアップグレードは即座に適用され、差額を請求いたします。請求間隔の変更は次回の請求日から適用されます。
						{/if}
					{:else}
						プランのダウングレード
						{#if billingInterval === 'year'}
							と月額から年額への変更です。プランのダウングレードは次回の請求日から適用されます。現在の請求期間終了後、新しいプランの年額での請求が開始されます。
						{:else}
							と年額から月額への変更です。変更は次回の請求日から適用されます。現在の請求期間終了まで、引き続き現在のプランをご利用いただけます。
						{/if}
					{/if}
				</p>
			</div>
		</div>
	{:else if selectedPlan === data.organization.plan_type && billingInterval !== currentBillingInterval}
		<div class="info-box upgrade">
			<div class="info-content">
				<h3 class="info-title">請求間隔の変更</h3>
				<p class="info-text">
					{#if billingInterval === 'year'}
						月額から年額への変更です。既にお支払いいただいた金額との差額を日割り計算し、即座に請求いたします。年額プランでは最大50%の割引が適用されます。
					{:else}
						年額から月額への変更です。変更は次回の請求日から適用されます。現在の請求期間終了まで、引き続き年額プランをご利用いただけます。
					{/if}
				</p>
			</div>
		</div>
	{:else if changeType === 'upgrade'}
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
				<span class="discount-badge">最大50%オフ</span>
			</button>
		</div>

		<div class="plans-container">
			{#each Object.entries(plans) as [planKey, plan]}
				{@const isCurrentPlan = planKey === data.organization.plan_type}
				{@const isSamePlanAndBilling = isCurrentPlan && billingInterval === currentBillingInterval}
				{@const displayPrice = billingInterval === 'month' ? plan.monthlyPrice : plan.yearlyPrice}
				<div
					class="plan-card"
					class:selected={selectedPlan === planKey}
					class:current={isSamePlanAndBilling}
					on:click={() => !isSamePlanAndBilling && (selectedPlan = planKey as 'basic' | 'standard' | 'premium')}
					role="button"
					tabindex="0"
					on:keypress={(e) => e.key === 'Enter' && !isSamePlanAndBilling && (selectedPlan = planKey as 'basic' | 'standard' | 'premium')}
				>
					{#if isSamePlanAndBilling}
						<div class="plan-badge current">現在のプラン</div>
					{/if}
					<h3 class="plan-name">{plan.name}</h3>
					<p class="plan-price">{formatPrice(displayPrice)}</p>
					<p class="plan-interval">/ {billingInterval === 'month' ? '月' : '年'}</p>
					{#if billingInterval === 'year'}
						<p class="plan-discount">{getDiscountRate(planKey as 'basic' | 'standard' | 'premium')}%オフ</p>
					{/if}
					<ul class="plan-features">
						{#each plan.features as feature}
							<li>{feature}</li>
						{/each}
					</ul>
					{#if !isSamePlanAndBilling}
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
				disabled={!selectedPlan || isSamePlanAndInterval || loading}
			>
				{#if loading}
					処理中...
				{:else if isFree}
					有料プランへアップグレード
				{:else}
					プランを変更する
				{/if}
			</button>
		</div>
	</form>
</div>

<Footer />

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
		background: var(--bg-primary);
		border: 2px solid var(--border-medium);
		border-radius: 12px;
		padding: 24px;
		text-align: center;
	}

	.plan-badge {
		display: inline-block;
		background: var(--bg-secondary);
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 600;
		padding: 6px 16px;
		border-radius: 8px;
		margin-bottom: 12px;
	}

	.plan-badge.current {
		background: var(--text-primary);
		color: var(--bg-primary);
	}

	/* 現在のプランカードの価格 */
	.current-price {
		font-size: 32px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	/* プラン選択カードの価格（黒色） */
	.plan-card .plan-price {
		font-size: 28px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 8px 0 0 0;
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
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 24px;
		display: flex;
		gap: 16px;
		align-items: flex-start;
		background: var(--bg-secondary);
		border: 2px solid var(--border-medium);
	}

	.info-icon {
		font-size: 24px;
		flex-shrink: 0;
		opacity: 0.7;
	}

	.info-content {
		flex: 1;
	}

	.info-title {
		font-size: 16px;
		font-weight: 700;
		margin: 0 0 8px 0;
		color: var(--text-primary);
	}

	.info-text {
		font-size: 14px;
		line-height: 1.6;
		margin: 0;
		color: var(--text-secondary);
	}

	.billing-toggle {
		display: flex;
		gap: 12px;
		margin-bottom: 24px;
		justify-content: center;
	}

	.toggle-btn {
		background: var(--bg-primary);
		border: 2px solid var(--border-medium);
		border-radius: 12px;
		padding: 12px 24px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text-primary);
	}

	.toggle-btn.active {
		background: var(--text-primary);
		border-color: var(--text-primary);
		color: var(--bg-primary);
	}

	.discount-badge {
		font-size: 12px;
		background: var(--bg-secondary);
		color: var(--text-primary);
		padding: 2px 8px;
		border-radius: 8px;
		border: 1px solid var(--border-light);
	}

	.toggle-btn.active .discount-badge {
		background: var(--bg-primary);
		color: var(--text-primary);
		border-color: var(--bg-primary);
	}

	.plans-container {
		display: grid;
		grid-template-columns: 1fr;
		gap: 20px;
		margin-bottom: 32px;
	}

	.plan-card {
		background: var(--bg-primary);
		border: 2px solid var(--border-light);
		border-radius: 12px;
		padding: 24px;
		text-align: center;
		cursor: pointer;
		transition: all 0.2s;
		position: relative;
	}

	.plan-card:hover:not(.current) {
		border-color: var(--border-dark);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		transform: translateY(-2px);
	}

	.plan-card.selected {
		border-color: var(--text-primary);
		background: var(--bg-secondary);
	}

	.plan-card.current {
		border-color: var(--border-medium);
		background: var(--bg-secondary);
		cursor: not-allowed;
		opacity: 0.6;
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
		margin: 0 0 4px 0;
	}

	.plan-discount {
		font-size: 14px;
		font-weight: 600;
		color: #2d7a3e;
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
		color: var(--text-primary);
		font-weight: bold;
		opacity: 0.6;
	}

	.select-indicator {
		margin-top: 16px;
		padding: 12px;
		background: var(--text-primary);
		color: var(--bg-primary);
		border-radius: 8px;
		font-weight: 600;
		font-size: 14px;
	}

	.plan-card:not(.selected) .select-indicator {
		background: var(--bg-secondary);
		color: var(--text-primary);
		border: 1px solid var(--border-medium);
	}

	.action-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.submit-btn {
		width: 100%;
		background: var(--text-primary);
		color: var(--bg-primary);
		border: none;
		border-radius: 12px;
		padding: 16px;
		font-size: 17px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.submit-btn:hover:not(:disabled) {
		opacity: 0.85;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.submit-btn:active:not(:disabled) {
		transform: scale(0.98);
	}

	.submit-btn:disabled {
		background: var(--bg-secondary);
		color: var(--text-secondary);
		border: 1px solid var(--border-light);
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
