<script lang="ts">
	import type { PageData } from './$types';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import {
		PUBLIC_STRIPE_PRICE_STANDARD_MONTHLY,
		PUBLIC_STRIPE_PRICE_STANDARD_YEARLY,
		PUBLIC_STRIPE_PRICE_PRO_MONTHLY,
		PUBLIC_STRIPE_PRICE_PRO_YEARLY
	} from '$env/static/public';

	export let data: PageData;

	let billingInterval: 'month' | 'year' = 'month';
	let loading = false;
	let errorMessage = '';

	// プラン定義
	const plans = [
		{
			id: 'free',
			name: 'フリー',
			monthlyPrice: 0,
			yearlyPrice: 0,
			features: [
				'月間3セッションまで',
				'選手数: 30名まで/セッション',
				'検定員: 5名まで/セッション',
				'基本的な採点機能',
				'Excelエクスポート',
				'検定モードのみ'
			],
			limitations: ['大会モード利用不可', '研修モード利用不可', 'スコアボード非公開'],
			color: 'gray'
		},
		{
			id: 'standard',
			name: 'スタンダード',
			monthlyPrice: 980,
			yearlyPrice: 9800,
			priceIdMonthly: PUBLIC_STRIPE_PRICE_STANDARD_MONTHLY,
			priceIdYearly: PUBLIC_STRIPE_PRICE_STANDARD_YEARLY,
			features: [
				'月間無制限セッション',
				'選手数: 100名まで/セッション',
				'検定員: 20名まで/セッション',
				'検定モード + 大会モード + 研修モード',
				'スコアボード公開機能',
				'メールサポート',
				'データ保存期間: 1年'
			],
			recommended: true,
			color: 'blue'
		},
		{
			id: 'pro',
			name: 'プロ',
			monthlyPrice: 2980,
			yearlyPrice: 29800,
			priceIdMonthly: PUBLIC_STRIPE_PRICE_PRO_MONTHLY,
			priceIdYearly: PUBLIC_STRIPE_PRICE_PRO_YEARLY,
			features: [
				'月間無制限セッション',
				'選手数: 無制限',
				'検定員: 無制限',
				'全モード利用可能',
				'スコアボード公開機能',
				'優先メールサポート',
				'データ保存期間: 無制限'
			],
			color: 'orange'
		}
	];

	// アップグレードボタンクリック
	async function handleUpgrade(planId: string) {
		if (!data.user) {
			goto('/login');
			return;
		}

		if (planId === 'free') {
			return; // フリープランへのアップグレードはなし
		}

		loading = true;
		errorMessage = '';

		try {
			const plan = plans.find((p) => p.id === planId);
			if (!plan) return;

			const priceId = billingInterval === 'month' ? plan.priceIdMonthly : plan.priceIdYearly;

			// Checkout Session作成APIを呼び出し
			const response = await fetch('/api/stripe/create-checkout-session', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					priceId,
					successUrl: `${window.location.origin}/account?success=true`,
					cancelUrl: `${window.location.origin}/pricing?canceled=true`
				})
			});

			const result = await response.json();

			if (!response.ok) {
				throw new Error(result.message || 'エラーが発生しました');
			}

			// Stripe Checkoutページにリダイレクト
			window.location.href = result.url;
		} catch (err: any) {
			console.error('Checkout error:', err);
			errorMessage = err.message || 'エラーが発生しました。もう一度お試しください。';
			loading = false;
		}
	}

	// 価格表示
	function formatPrice(price: number, interval: 'month' | 'year'): string {
		if (price === 0) return '無料';
		return `¥${price.toLocaleString()}/${interval === 'month' ? '月' : '年'}`;
	}

	// 年間割引額の計算
	function getSavings(monthlyPrice: number, yearlyPrice: number): number {
		return monthlyPrice * 12 - yearlyPrice;
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

<Header showAppName={true} />

<div class="container">
	<div class="header-section">
		<h1 class="title">料金プラン</h1>
		<p class="subtitle">あなたに最適なプランを選択してください</p>

		<!-- 請求サイクル切り替え -->
		<div class="billing-toggle">
			<button
				class="toggle-btn"
				class:active={billingInterval === 'month'}
				on:click={() => (billingInterval = 'month')}
			>
				月額
			</button>
			<button
				class="toggle-btn"
				class:active={billingInterval === 'year'}
				on:click={() => (billingInterval = 'year')}
			>
				年額
				<span class="badge">お得</span>
			</button>
		</div>
	</div>

	{#if errorMessage}
		<div class="error-message">{errorMessage}</div>
	{/if}

	<!-- プランカード -->
	<div class="plans-grid">
		{#each plans as plan}
			<div class="plan-card" class:recommended={plan.recommended} class:current={data.currentPlan === plan.id}>
				{#if plan.recommended}
					<div class="recommended-badge">おすすめ</div>
				{/if}
				{#if data.currentPlan === plan.id}
					<div class="current-badge">現在のプラン</div>
				{/if}

				<h2 class="plan-name">{plan.name}</h2>

				<div class="price-section">
					<div class="price">
						{formatPrice(
							billingInterval === 'month' ? plan.monthlyPrice : plan.yearlyPrice,
							billingInterval
						)}
					</div>
					{#if billingInterval === 'year' && plan.monthlyPrice > 0}
						<div class="savings">
							年間 ¥{getSavings(plan.monthlyPrice, plan.yearlyPrice).toLocaleString()} お得
						</div>
					{/if}
				</div>

				<ul class="features-list">
					{#each plan.features as feature}
						<li class="feature">✓ {feature}</li>
					{/each}
					{#if plan.limitations}
						{#each plan.limitations as limitation}
							<li class="limitation">✗ {limitation}</li>
						{/each}
					{/if}
				</ul>

				{#if plan.id === 'free'}
					{#if data.currentPlan === 'free'}
						<button class="upgrade-btn current" disabled>現在のプラン</button>
					{:else}
						<button class="upgrade-btn downgrade" disabled>ダウングレード</button>
					{/if}
				{:else if data.currentPlan === plan.id}
					<button class="upgrade-btn current" disabled>現在のプラン</button>
				{:else}
					<button
						class="upgrade-btn"
						class:loading
						on:click={() => handleUpgrade(plan.id)}
						disabled={loading}
					>
						{loading ? '処理中...' : data.user ? 'アップグレード' : 'ログインして購入'}
					</button>
				{/if}
			</div>
		{/each}
	</div>

	<!-- 機能比較表 -->
	<div class="comparison-section">
		<h2 class="comparison-title">詳細な機能比較</h2>
		<div class="comparison-table-container">
			<table class="comparison-table">
				<thead>
					<tr>
						<th>機能</th>
						<th>フリー</th>
						<th>スタンダード</th>
						<th>プロ</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>月間セッション数</td>
						<td>3</td>
						<td>無制限</td>
						<td>無制限</td>
					</tr>
					<tr>
						<td>選手数/セッション</td>
						<td>30名</td>
						<td>100名</td>
						<td>無制限</td>
					</tr>
					<tr>
						<td>検定員数/セッション</td>
						<td>5名</td>
						<td>20名</td>
						<td>無制限</td>
					</tr>
					<tr>
						<td>検定モード</td>
						<td>✓</td>
						<td>✓</td>
						<td>✓</td>
					</tr>
					<tr>
						<td>大会モード</td>
						<td>✗</td>
						<td>✓</td>
						<td>✓</td>
					</tr>
					<tr>
						<td>研修モード</td>
						<td>✗</td>
						<td>✓</td>
						<td>✓</td>
					</tr>
					<tr>
						<td>スコアボード</td>
						<td>✗</td>
						<td>✓</td>
						<td>✓</td>
					</tr>
					<tr>
						<td>データ保存期間</td>
						<td>3ヶ月</td>
						<td>1年</td>
						<td>無制限</td>
					</tr>
					<tr>
						<td>サポート</td>
						<td>メール</td>
						<td>メール</td>
						<td>優先メール</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		max-width: 1200px;
		margin: 0 auto;
	}

	.header-section {
		text-align: center;
		margin-bottom: 40px;
	}

	.title {
		font-size: 32px;
		font-weight: 700;
		margin-bottom: 12px;
		color: var(--primary-text);
	}

	.subtitle {
		font-size: 16px;
		color: var(--secondary-text);
		margin-bottom: 28px;
	}

	.billing-toggle {
		display: inline-flex;
		background: #f8f9fa;
		border-radius: 10px;
		padding: 4px;
		gap: 4px;
	}

	.toggle-btn {
		padding: 10px 24px;
		border: none;
		background: transparent;
		border-radius: 8px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		color: var(--secondary-text);
		position: relative;
	}

	.toggle-btn.active {
		background: white;
		color: var(--ios-blue);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	.badge {
		display: inline-block;
		background: var(--primary-orange);
		color: white;
		font-size: 11px;
		padding: 2px 6px;
		border-radius: 4px;
		margin-left: 6px;
	}

	.error-message {
		background: #fee;
		color: #c33;
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 24px;
		text-align: center;
	}

	.plans-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 24px;
		margin-bottom: 60px;
	}

	.plan-card {
		background: white;
		border: 2px solid var(--separator-gray);
		border-radius: 16px;
		padding: 32px 24px;
		position: relative;
		transition: all 0.3s;
	}

	.plan-card.recommended {
		border-color: var(--ios-blue);
		box-shadow: 0 4px 16px rgba(0, 122, 255, 0.15);
	}

	.plan-card.current {
		border-color: var(--ios-green);
		background: #f8fff9;
	}

	.recommended-badge {
		position: absolute;
		top: -12px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--ios-blue);
		color: white;
		padding: 6px 16px;
		border-radius: 20px;
		font-size: 13px;
		font-weight: 600;
	}

	.current-badge {
		position: absolute;
		top: -12px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--ios-green);
		color: white;
		padding: 6px 16px;
		border-radius: 20px;
		font-size: 13px;
		font-weight: 600;
	}

	.plan-name {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 16px;
		color: var(--primary-text);
	}

	.price-section {
		margin-bottom: 24px;
		border-bottom: 1px solid var(--separator-gray);
		padding-bottom: 24px;
	}

	.price {
		font-size: 36px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 8px;
	}

	.savings {
		font-size: 14px;
		color: var(--primary-orange);
		font-weight: 600;
	}

	.features-list {
		list-style: none;
		padding: 0;
		margin: 0 0 24px 0;
	}

	.feature {
		padding: 10px 0;
		font-size: 15px;
		color: var(--primary-text);
	}

	.limitation {
		padding: 10px 0;
		font-size: 15px;
		color: var(--secondary-text);
	}

	.upgrade-btn {
		width: 100%;
		padding: 14px;
		border: none;
		border-radius: 10px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		background: var(--ios-blue);
		color: white;
	}

	.upgrade-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.upgrade-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.upgrade-btn.current {
		background: var(--ios-green);
	}

	.upgrade-btn.downgrade {
		background: var(--secondary-text);
	}

	.upgrade-btn.loading {
		opacity: 0.7;
	}

	.comparison-section {
		margin-top: 60px;
	}

	.comparison-title {
		font-size: 24px;
		font-weight: 700;
		text-align: center;
		margin-bottom: 28px;
		color: var(--primary-text);
	}

	.comparison-table-container {
		overflow-x: auto;
	}

	.comparison-table {
		width: 100%;
		background: white;
		border-radius: 12px;
		overflow: hidden;
		border-collapse: collapse;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		table-layout: fixed;
	}

	.comparison-table th {
		background: #f8f9fa;
		padding: 16px;
		text-align: left;
		font-weight: 600;
		color: var(--primary-text);
		border-bottom: 2px solid var(--separator-gray);
	}

	.comparison-table th:first-child,
	.comparison-table td:first-child {
		width: 25%;
	}

	.comparison-table th:nth-child(2),
	.comparison-table th:nth-child(3),
	.comparison-table th:nth-child(4) {
		width: 25%;
		text-align: center;
	}

	.comparison-table td {
		padding: 16px;
		border-bottom: 1px solid var(--separator-gray);
		color: var(--primary-text);
	}

	.comparison-table td:nth-child(2),
	.comparison-table td:nth-child(3),
	.comparison-table td:nth-child(4) {
		text-align: center;
	}

	.comparison-table tbody tr:last-child td {
		border-bottom: none;
	}

	.comparison-table td:first-child {
		font-weight: 600;
	}

	@media (max-width: 768px) {
		.title {
			font-size: 24px;
		}

		.plans-grid {
			grid-template-columns: 1fr;
		}

		.comparison-table {
			font-size: 14px;
		}

		.comparison-table th,
		.comparison-table td {
			padding: 12px 8px;
		}
	}
</style>
