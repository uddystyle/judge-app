<script lang="ts">
	import { goto } from '$app/navigation';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { getContext } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { PageData } from './$types';

	export let data: PageData;
	const supabase = getContext<SupabaseClient>('supabase');

	// サブスクリプション済みかどうか
	const hasSubscription = !!data.subscription;
	const existingPlanType = data.subscription?.plan_type as
		| 'basic'
		| 'standard'
		| 'premium'
		| null;

	let organizationName = '';
	let selectedPlan: 'basic' | 'standard' | 'premium' | null = existingPlanType || null;
	let billingInterval: 'month' | 'year' = 'month';
	let loading = false;
	let errorMessage = '';

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

	async function handleCreateOrganization() {
		// バリデーション
		if (!organizationName.trim()) {
			errorMessage = '組織名を入力してください。';
			return;
		}

		if (!selectedPlan) {
			errorMessage = 'プランを選択してください。';
			return;
		}

		loading = true;
		errorMessage = '';

		try {
			// サブスクリプション済みの場合は直接組織を作成
			if (hasSubscription) {
				const response = await fetch('/api/organization/create', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						organizationName: organizationName.trim(),
						planType: selectedPlan
					})
				});

				const result = await response.json();

				if (!response.ok) {
					throw new Error(result.error || 'エラーが発生しました');
				}

				// 成功したらダッシュボードへリダイレクト
				goto('/dashboard');
			} else {
				// サブスクリプションがない場合はStripe Checkoutへ
				const requestBody: any = {
					organizationName: organizationName.trim(),
					planType: selectedPlan,
					billingInterval: billingInterval,
					returnUrl: window.location.origin + '/dashboard',
					cancelUrl: window.location.href
				};

				// クーポンコードがある場合は追加
				if (data.coupon) {
					requestBody.couponCode = data.coupon.id;
				}

				const response = await fetch('/api/stripe/create-organization-checkout', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(requestBody)
				});

				const result = await response.json();

				if (!response.ok) {
					throw new Error(result.message || 'エラーが発生しました');
				}

				// Stripe Checkoutページにリダイレクト
				window.location.href = result.url;
			}
		} catch (err: any) {
			console.error('Organization creation error:', err);
			errorMessage = err.message || 'エラーが発生しました。もう一度お試しください。';
			loading = false;
		}
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

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} />

<div class="container">
	<div class="instruction">組織を作成</div>

	<!-- クーポン適用バッジ -->
	{#if data.coupon}
		<div class="coupon-badge">
			🎉 特別割引が適用されます:
			{#if data.coupon.percentOff}
				{data.coupon.percentOff}% OFF
			{:else if data.coupon.amountOff}
				¥{(data.coupon.amountOff / 100).toLocaleString()} OFF
			{/if}
		</div>
	{/if}

	<div class="form-container">
		<div class="form-section">
			<label for="org-name" class="form-label">組織名</label>
			<input
				type="text"
				id="org-name"
				bind:value={organizationName}
				placeholder="例: 〇〇スキークラブ"
				class="input-field"
				disabled={loading}
			/>
			<p class="help-text">スキークラブ、スキー学校などの組織名を入力してください</p>
		</div>

		<hr class="divider" />

		{#if hasSubscription}
			<!-- サブスクリプション済みの場合：現在のプラン情報を表示 -->
			<div class="form-section">
				<h3 class="section-title">プラン</h3>
				<div class="current-plan-info">
					<div class="plan-badge">{plans[existingPlanType].name}</div>
					<p class="plan-description">
						現在のサブスクリプションを使用して組織を作成します。
					</p>
				</div>
			</div>
		{:else}
			<!-- サブスクリプションがない場合：プラン選択UI -->
			<div class="form-section">
				<h3 class="section-title">請求間隔</h3>
				<div class="billing-toggle">
					<button
						class="toggle-btn"
						class:active={billingInterval === 'month'}
						on:click={() => (billingInterval = 'month')}
						disabled={loading}
					>
						月払い
					</button>
					<button
						class="toggle-btn"
						class:active={billingInterval === 'year'}
						on:click={() => (billingInterval = 'year')}
						disabled={loading}
					>
						年払い<span class="discount-badge">お得</span>
					</button>
				</div>
			</div>

			<hr class="divider" />

			<div class="form-section">
				<h3 class="section-title">プラン選択</h3>

				<div class="plans-grid">
					{#each Object.entries(plans) as [planKey, plan]}
						<button
							class="plan-card"
							class:selected={selectedPlan === planKey}
							on:click={() => (selectedPlan = planKey as 'basic' | 'standard' | 'premium')}
							disabled={loading}
						>
							<div class="plan-header">
								<h4 class="plan-name">{plan.name}</h4>
								<div class="plan-price">
									{formatPrice(getPrice(planKey as 'basic' | 'standard' | 'premium'))}
									<span class="price-unit">/{billingInterval === 'month' ? '月' : '年'}</span>
								</div>
							</div>

							<div class="plan-members">
								組織メンバー{plan.maxMembers}名 / 検定員{plan.maxJudges}名まで
							</div>

							<ul class="plan-features">
								{#each plan.features as feature}
									<li>{feature}</li>
								{/each}
							</ul>

							{#if selectedPlan === planKey}
								<div class="selected-badge">✓ 選択中</div>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#if errorMessage}
			<p class="error-message">{errorMessage}</p>
		{/if}

		<div class="nav-buttons">
			<NavButton variant="primary" on:click={handleCreateOrganization} disabled={loading}>
				{#if loading}
					処理中...
				{:else if hasSubscription}
					組織を作成
				{:else}
					次へ（お支払いページへ）
				{/if}
			</NavButton>
			<NavButton on:click={() => goto('/dashboard')} disabled={loading}>
				キャンセル
			</NavButton>
		</div>
	</div>
</div>

<style>
	.container {
		padding: 50px 20px 60px;
		text-align: center;
		max-width: 800px;
		margin: 0 auto;
		min-height: calc(100vh - 80px);
	}
	.instruction {
		font-size: 32px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 40px;
	}

	.coupon-badge {
		display: inline-block;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		padding: 12px 24px;
		border-radius: 12px;
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 24px;
		box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.05);
		}
	}

	.form-container {
		display: flex;
		flex-direction: column;
		gap: 24px;
		background: var(--bg-white);
		padding: 32px;
		border-radius: 20px;
		border: 2px solid var(--border-light);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
		text-align: left;
	}
	.form-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.form-label {
		font-size: 16px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.input-field {
		padding: 16px;
		font-size: 17px;
		border: 2px solid var(--border-light);
		border-radius: 12px;
		background: var(--bg-white);
		color: var(--text-primary);
		transition: all 0.2s;
	}
	.input-field:focus {
		outline: none;
		border-color: var(--primary-orange);
		box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.1);
	}
	.help-text {
		font-size: 14px;
		color: var(--text-secondary);
		margin: 0;
	}
	.section-title {
		font-size: 18px;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
	}
	.billing-toggle {
		display: flex;
		gap: 12px;
	}
	.toggle-btn {
		flex: 1;
		padding: 14px 20px;
		font-size: 16px;
		font-weight: 600;
		border: 2px solid var(--border-light);
		border-radius: 12px;
		background: var(--bg-white);
		color: var(--text-primary);
		cursor: pointer;
		transition: all 0.2s;
		position: relative;
	}
	.toggle-btn:hover {
		border-color: var(--primary-orange);
	}
	.toggle-btn.active {
		border-color: var(--primary-orange);
		background: var(--primary-orange);
		color: white;
	}
	.discount-badge {
		margin-left: 6px;
		font-size: 12px;
		padding: 2px 6px;
		background: var(--ios-green);
		color: white;
		border-radius: 4px;
	}
	.plans-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 16px;
	}
	.plan-card {
		padding: 24px;
		border: 2px solid var(--border-light);
		border-radius: 16px;
		background: var(--bg-white);
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
		position: relative;
	}
	.plan-card:hover {
		border-color: var(--primary-orange);
		box-shadow: 0 4px 16px rgba(255, 107, 53, 0.15);
	}
	.plan-card.selected {
		border-color: var(--primary-orange);
		background: var(--primary-orange-hover);
		box-shadow: 0 4px 16px rgba(255, 107, 53, 0.2);
	}
	.plan-header {
		margin-bottom: 12px;
	}
	.plan-name {
		font-size: 20px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 8px 0;
	}
	.plan-price {
		font-size: 28px;
		font-weight: 700;
		color: var(--primary-orange);
	}
	.price-unit {
		font-size: 16px;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.plan-members {
		font-size: 16px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 16px;
		padding: 8px 12px;
		background: var(--bg-beige);
		border-radius: 8px;
	}
	.plan-features {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.plan-features li {
		font-size: 14px;
		color: var(--text-secondary);
		padding-left: 20px;
		position: relative;
	}
	.plan-features li::before {
		content: '✓';
		position: absolute;
		left: 0;
		color: var(--ios-green);
		font-weight: 700;
	}
	.selected-badge {
		position: absolute;
		top: 16px;
		right: 16px;
		background: var(--primary-orange);
		color: white;
		padding: 6px 12px;
		border-radius: 20px;
		font-size: 12px;
		font-weight: 600;
	}
	.error-message {
		color: var(--ios-red);
		font-size: 14px;
		margin: 0;
		padding: 12px;
		background: #fff5f5;
		border-radius: 8px;
		border: 1px solid #ffdddd;
		text-align: center;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 8px;
	}
	.divider {
		border: none;
		border-top: 1px solid var(--separator-gray);
		margin: 8px 0;
	}
	.current-plan-info {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px;
		background: var(--bg-beige);
		border-radius: 12px;
		border: 2px solid var(--primary-orange);
	}
	.plan-badge {
		font-size: 20px;
		font-weight: 700;
		color: var(--primary-orange);
	}
	.plan-description {
		font-size: 14px;
		color: var(--text-secondary);
		margin: 0;
	}

	@media (min-width: 768px) {
		.plans-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
</style>
