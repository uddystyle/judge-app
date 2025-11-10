<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	// URLパラメータからプランとクーポンを取得
	const urlPlan = $page.url.searchParams.get('plan') as 'basic' | 'standard' | 'premium' | null;
	const urlCoupon = $page.url.searchParams.get('coupon');
	let selectedPlan: 'basic' | 'standard' | 'premium' | null = urlPlan && ['basic', 'standard', 'premium'].includes(urlPlan) ? urlPlan : null;
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
			features: ['組織メンバー10名まで', '検定員15名まで', 'セッション無制限', '検定・大会・研修モード']
		},
		standard: {
			name: 'Standard',
			maxMembers: 30,
			maxJudges: 50,
			monthlyPrice: 24800,
			yearlyPrice: 248000,
			features: ['組織メンバー30名まで', '検定員50名まで', 'セッション無制限', '検定・大会・研修モード']
		},
		premium: {
			name: 'Premium',
			maxMembers: 100,
			maxJudges: 100,
			monthlyPrice: 49800,
			yearlyPrice: 498000,
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

	async function handleUpgrade() {
		if (!selectedPlan) {
			errorMessage = 'プランを選択してください';
			return;
		}

		loading = true;
		errorMessage = '';

		try {
			const requestBody: any = {
				organizationId: data.organization.id,
				planType: selectedPlan,
				billingInterval,
				returnUrl: `${window.location.origin}/account`,
				cancelUrl: window.location.href
			};

			// クーポンコードがある場合は追加
			if (urlCoupon) {
				requestBody.couponCode = urlCoupon;
			}

			const response = await fetch('/api/stripe/upgrade-organization', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(requestBody)
			});

			if (!response.ok) {
				const error = await response.json();
				console.error('[Upgrade Error] Response:', error);
				throw new Error(error.message || 'エラーが発生しました');
			}

			const result = await response.json();
			console.log('[Upgrade Success] Redirecting to:', result.url);
			window.location.href = result.url;
		} catch (error: any) {
			console.error('[Upgrade Error] Exception:', error);
			errorMessage = error.message || 'エラーが発生しました';
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
	<div class="header">
		<h1 class="title">プランをアップグレード</h1>
		<p class="subtitle">
			組織「{data.organization.name}」を有料プランにアップグレードして、より多くの機能を利用しましょう。
		</p>
		{#if urlCoupon}
			<div class="coupon-badge">
				<span class="coupon-icon">🎟️</span>
				<span class="coupon-text">クーポン適用: {urlCoupon}</span>
			</div>
		{/if}
	</div>

	{#if errorMessage}
		<div class="error-message">{errorMessage}</div>
	{/if}

	<div class="upgrade-container">
		<!-- 請求間隔の選択 -->
		<div class="billing-selector">
			<h3>請求間隔</h3>
			<div class="billing-buttons">
				<button
					class="billing-btn"
					class:selected={billingInterval === 'month'}
					on:click={() => (billingInterval = 'month')}
				>
					月払い
				</button>
				<button
					class="billing-btn"
					class:selected={billingInterval === 'year'}
					on:click={() => (billingInterval = 'year')}
				>
					年払い（2ヶ月分お得）
				</button>
			</div>
		</div>

		<!-- プラン選択 -->
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
						<div class="selected-badge">選択中</div>
					{/if}
				</button>
			{/each}
		</div>

		<!-- アクションボタン -->
		<div class="actions">
			<NavButton on:click={() => goto('/pricing')} disabled={loading}>
				キャンセル
			</NavButton>
			<NavButton variant="primary" on:click={handleUpgrade} disabled={loading || !selectedPlan}>
				{loading ? '処理中...' : '支払いに進む'}
			</NavButton>
		</div>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		max-width: 1000px;
		margin: 0 auto;
	}

	.header {
		text-align: center;
		margin-bottom: 40px;
	}

	.title {
		font-size: 28px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 12px;
	}

	.subtitle {
		font-size: 15px;
		color: var(--secondary-text);
		line-height: 1.6;
	}

	.coupon-badge {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
		border: 2px solid var(--border-medium);
		border-radius: 20px;
		padding: 8px 16px;
		margin-top: 16px;
		font-size: 14px;
		font-weight: 600;
		color: var(--primary-text);
	}

	.coupon-icon {
		font-size: 16px;
	}

	.coupon-text {
		letter-spacing: 0.02em;
	}

	.error-message {
		background: #fee;
		color: #c33;
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 20px;
		text-align: center;
		font-size: 14px;
	}

	.upgrade-container {
		background: white;
		border-radius: 16px;
		padding: 32px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.billing-selector {
		margin-bottom: 32px;
	}

	.billing-selector h3 {
		font-size: 18px;
		font-weight: 600;
		color: var(--primary-text);
		margin-bottom: 16px;
	}

	.billing-buttons {
		display: flex;
		gap: 12px;
	}

	.billing-btn {
		flex: 1;
		padding: 12px 20px;
		background: white;
		border: 2px solid var(--border-light);
		border-radius: 10px;
		font-size: 15px;
		font-weight: 600;
		color: var(--text-primary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.billing-btn:hover {
		border-color: var(--accent-primary);
	}

	.billing-btn.selected {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: white;
	}

	.section-title {
		font-size: 18px;
		font-weight: 600;
		color: var(--primary-text);
		margin-bottom: 20px;
		text-align: center;
	}

	.plans-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 20px;
		margin-bottom: 32px;
	}

	.plan-card {
		background: white;
		border: 2px solid var(--border-light);
		border-radius: 12px;
		padding: 24px;
		cursor: pointer;
		transition: all 0.2s;
		position: relative;
		text-align: left;
	}

	.plan-card:hover {
		border-color: var(--accent-primary);
		box-shadow: 0 4px 12px rgba(255, 107, 53, 0.15);
	}

	.plan-card.selected {
		border-color: var(--accent-primary);
		background: linear-gradient(135deg, #fff8f3 0%, #ffffff 100%);
	}

	.plan-card:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.plan-header {
		margin-bottom: 16px;
	}

	.plan-name {
		font-size: 20px;
		font-weight: 700;
		color: var(--primary-text);
		margin: 0 0 8px 0;
	}

	.plan-price {
		font-size: 24px;
		font-weight: 700;
		color: var(--accent-primary);
	}

	.price-unit {
		font-size: 14px;
		font-weight: 500;
		color: var(--secondary-text);
	}

	.plan-members {
		font-size: 14px;
		font-weight: 600;
		color: var(--ios-blue);
		margin-bottom: 16px;
	}

	.plan-features {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.plan-features li {
		font-size: 14px;
		color: var(--text-primary);
		margin-bottom: 8px;
		padding-left: 20px;
		position: relative;
	}

	.plan-features li::before {
		content: '✓';
		position: absolute;
		left: 0;
		color: #2d7a3e;
		font-weight: 700;
	}

	.selected-badge {
		position: absolute;
		top: 12px;
		right: 12px;
		background: var(--accent-primary);
		color: white;
		padding: 4px 12px;
		border-radius: 20px;
		font-size: 12px;
		font-weight: 600;
	}

	.actions {
		display: flex;
		gap: 12px;
		justify-content: center;
	}

	@media (max-width: 768px) {
		.title {
			font-size: 24px;
		}

		.upgrade-container {
			padding: 24px 20px;
		}

		.plans-grid {
			grid-template-columns: 1fr;
		}

		.billing-buttons {
			flex-direction: column;
		}

		.actions {
			flex-direction: column;
		}
	}
</style>
