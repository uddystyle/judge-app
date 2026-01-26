<script lang="ts">
	import type { PageData } from './$types';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	export let data: PageData;

	let billingInterval: 'month' | 'year' = 'month';
	let portalLoading = false;

	// URLパラメータから組織IDを取得
	$: orgId = $page.url.searchParams.get('org');

	// プラン変更の成功メッセージ
	$: planChanged = $page.url.searchParams.get('changed') === 'true';
	$: isScheduled = $page.url.searchParams.get('scheduled') === 'true';

	// プラン定義（組織向け）
	// 料金プランページは情報提供が目的のため、アクションボタンは配置しない
	// 組織作成やプラン変更はダッシュボード/アカウントページから実行
	const plans = [
		{
			id: 'free',
			name: 'フリー',
			subtitle: '個人利用',
			monthlyPrice: 0,
			yearlyPrice: 0,
			maxMembers: '組織メンバー: 1名のみ',
			features: [
				'組織メンバー: 1名のみ',
				'検定員: 3名まで',
				'月間セッション: 3個まで',
				'検定モードのみ',
				'Excelエクスポート',
				'メールサポート'
			],
			limitations: ['大会モード利用不可', '研修モード利用不可'],
			color: 'gray'
		},
		{
			id: 'basic',
			name: 'Basic',
			subtitle: '小規模クラブ向け',
			monthlyPrice: 8800,
			yearlyPrice: 70000,
			maxMembers: '組織メンバー: 10名まで',
			features: [
				'組織メンバー: 10名まで',
				'検定員: 15名まで',
				'月間セッション: 無制限',
				'検定・大会・研修モード',
				'スコアボード公開機能',
				'Excelエクスポート',
				'メールサポート'
			],
			color: 'blue'
		},
		{
			id: 'standard',
			name: 'Standard',
			subtitle: '中規模組織向け',
			monthlyPrice: 24800,
			yearlyPrice: 180000,
			maxMembers: '組織メンバー: 30名まで',
			features: [
				'組織メンバー: 30名まで',
				'検定員: 50名まで',
				'月間セッション: 無制限',
				'検定・大会・研修モード',
				'スコアボード公開機能',
				'Excelエクスポート',
				'メールサポート'
			],
			recommended: true,
			color: 'blue'
		},
		{
			id: 'premium',
			name: 'Premium',
			subtitle: '大規模組織向け',
			monthlyPrice: 49800,
			yearlyPrice: 300000,
			maxMembers: '組織メンバー: 100名まで',
			features: [
				'組織メンバー: 100名まで',
				'検定員: 100名まで',
				'月間セッション: 無制限',
				'検定・大会・研修モード',
				'スコアボード公開機能',
				'Excelエクスポート',
				'優先サポート'
			],
			color: 'orange'
		}
	];

	// 価格表示
	function formatPrice(price: number, interval: 'month' | 'year'): string {
		if (price === 0) return '無料';
		return `¥${price.toLocaleString()}/${interval === 'month' ? '月' : '年'}`;
	}

	// 年間割引額の計算
	function getSavings(monthlyPrice: number, yearlyPrice: number): number {
		return monthlyPrice * 12 - yearlyPrice;
	}

	// Stripe Customer Portalを開く
	async function openCustomerPortal() {
		if (!data.organizations || data.organizations.length === 0) {
			alert('組織が見つかりません。');
			return;
		}

		// URLパラメータで指定された組織ID、または最初の組織IDを使用
		const targetOrgId = orgId || data.organizations[0].organization_id;

		portalLoading = true;
		try {
			const response = await fetch('/api/stripe/customer-portal', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					organizationId: targetOrgId,
					returnUrl: window.location.href
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.message || 'Customer Portalの作成に失敗しました');
			}

			const result = await response.json();
			window.location.href = result.url;
		} catch (error: any) {
			console.error('Customer Portal Error:', error);
			alert(`プラン管理画面の表示に失敗しました。\n\nエラー: ${error.message}`);
			portalLoading = false;
		}
	}
</script>

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} hasOrganization={data.hasOrganization} />

<div class="container">
	<!-- プラン変更の成功メッセージ -->
	{#if planChanged}
		<div class="success-message-container">
			{#if isScheduled}
				<div class="success-message scheduled">
					<div class="message-icon">📅</div>
					<div class="message-content">
						<h3 class="message-title">プラン変更を予約しました</h3>
						<p class="message-text">
							プラン変更は次回の請求日から適用されます。現在の請求期間終了まで、引き続き現在のプランの機能をご利用いただけます。
						</p>
					</div>
				</div>
			{:else}
				<div class="success-message">
					<div class="message-icon">✅</div>
					<div class="message-content">
						<h3 class="message-title">プラン変更が完了しました</h3>
						<p class="message-text">新しいプランの機能がすぐにご利用いただけます。</p>
					</div>
				</div>
			{/if}
		</div>
	{/if}

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

	<!-- プランカード -->
	<div class="plans-grid">
		{#each plans as plan}
			{@const isSamePlan = data.user && data.currentPlan === plan.id}
			{@const isSameInterval = String(data.currentBillingInterval) === String(billingInterval)}
			{@const isCurrentPlanAndInterval = isSamePlan && (plan.id === 'free' || isSameInterval)}
			<div class="plan-card" class:recommended={plan.recommended} class:current={isCurrentPlanAndInterval}>
				{#if plan.recommended}
					<div class="recommended-badge">おすすめ</div>
				{/if}
				{#if isCurrentPlanAndInterval}
					<div class="current-badge">現在のプラン</div>
				{/if}

				<h2 class="plan-name">{plan.name}</h2>
				<p class="plan-subtitle">{plan.subtitle}</p>

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

				<div class="max-members">{plan.maxMembers}</div>

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
			</div>
		{/each}
	</div>

	<!-- 機能比較表 -->
	<div class="comparison-section">
		<h2 class="comparison-title">詳細な機能比較</h2>

		<!-- モバイル: カード表示 -->
		<div class="comparison-cards mobile-only">
			{#each plans as plan}
				<div class="comparison-card">
					<h3 class="card-plan-name">{plan.name}</h3>
					<div class="card-features">
						<div class="card-feature-row">
							<span class="card-label">月額料金</span>
							<span class="card-value">{plan.id === 'free' ? '¥0' : `¥${plan.monthlyPrice.toLocaleString()}`}</span>
						</div>
						<div class="card-feature-row">
							<span class="card-label">組織メンバー</span>
							<span class="card-value">{plan.id === 'free' ? '1名' : plan.id === 'basic' ? '10名' : plan.id === 'standard' ? '30名' : '100名'}</span>
						</div>
						<div class="card-feature-row">
							<span class="card-label">検定員数</span>
							<span class="card-value">{plan.id === 'free' ? '3名' : plan.id === 'basic' ? '15名' : plan.id === 'standard' ? '50名' : '100名'}</span>
						</div>
						<div class="card-feature-row">
							<span class="card-label">月間セッション</span>
							<span class="card-value">{plan.id === 'free' ? '3個' : '無制限'}</span>
						</div>
						<div class="card-feature-row">
							<span class="card-label">検定モード</span>
							<span class="card-value">✓</span>
						</div>
						<div class="card-feature-row">
							<span class="card-label">大会モード</span>
							<span class="card-value">{plan.id === 'free' ? '✗' : '✓'}</span>
						</div>
						<div class="card-feature-row">
							<span class="card-label">研修モード</span>
							<span class="card-value">{plan.id === 'free' ? '✗' : '✓'}</span>
						</div>
						<div class="card-feature-row">
							<span class="card-label">スコアボード</span>
							<span class="card-value">{plan.id === 'free' ? '✗' : '✓'}</span>
						</div>
						<div class="card-feature-row">
							<span class="card-label">エクスポート</span>
							<span class="card-value">✓</span>
						</div>
						<div class="card-feature-row">
							<span class="card-label">保存期間</span>
							<span class="card-value">{plan.id === 'free' ? '3ヶ月' : plan.id === 'basic' ? '12ヶ月' : plan.id === 'standard' ? '24ヶ月' : '無制限'}</span>
						</div>
						<div class="card-feature-row">
							<span class="card-label">サポート</span>
							<span class="card-value">{plan.id === 'premium' ? '優先' : 'メール'}</span>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- タブレット以上: テーブル表示 -->
		<div class="comparison-table-container desktop-only">
			<table class="comparison-table">
				<thead>
					<tr>
						<th>機能</th>
						<th>フリー</th>
						<th>Basic</th>
						<th>Standard</th>
						<th>Premium</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>月額料金</td>
						<td>¥0</td>
						<td>¥8,800</td>
						<td>¥24,800</td>
						<td>¥49,800</td>
					</tr>
					<tr>
						<td>組織メンバー</td>
						<td>1名</td>
						<td>10名</td>
						<td>30名</td>
						<td>100名</td>
					</tr>
					<tr>
						<td>検定員数</td>
						<td>3名</td>
						<td>15名</td>
						<td>50名</td>
						<td>100名</td>
					</tr>
					<tr>
						<td>月間セッション</td>
						<td>3個</td>
						<td>無制限</td>
						<td>無制限</td>
						<td>無制限</td>
					</tr>
					<tr>
						<td>検定モード</td>
						<td>✓</td>
						<td>✓</td>
						<td>✓</td>
						<td>✓</td>
					</tr>
					<tr>
						<td>大会モード</td>
						<td>✗</td>
						<td>✓</td>
						<td>✓</td>
						<td>✓</td>
					</tr>
					<tr>
						<td>研修モード</td>
						<td>✗</td>
						<td>✓</td>
						<td>✓</td>
						<td>✓</td>
					</tr>
					<tr>
						<td>スコアボード</td>
						<td>✗</td>
						<td>✓</td>
						<td>✓</td>
						<td>✓</td>
					</tr>
					<tr>
						<td>エクスポート</td>
						<td>✓</td>
						<td>✓</td>
						<td>✓</td>
						<td>✓</td>
					</tr>
					<tr>
						<td>保存期間</td>
						<td>3ヶ月</td>
						<td>12ヶ月</td>
						<td>24ヶ月</td>
						<td>無制限</td>
					</tr>
					<tr>
						<td>サポート</td>
						<td>メール</td>
						<td>メール</td>
						<td>メール</td>
						<td>優先</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>

	<!-- 戻るボタン -->
	<div class="back-button-section">
		{#if data.user}
			{#if data.currentPlan === 'free'}
				<!-- フリープランのユーザー: プラン変更ページへ -->
				{#if data.organizations && data.organizations.length > 0}
					{@const targetOrgId = orgId || data.organizations[0].organization_id}
					<button class="back-btn" on:click={() => goto(`/organization/${targetOrgId}/change-plan`)}>
						プランを変更する
					</button>
				{:else}
					<button class="back-btn" on:click={() => goto('/organizations')}>
						組織を作成する
					</button>
				{/if}
			{:else}
				<!-- 有料プランのユーザー: Stripe Customer Portalへ -->
				<button class="back-btn cancel" on:click={openCustomerPortal} disabled={portalLoading}>
					{#if portalLoading}
						処理中...
					{:else}
						プランをキャンセルする
					{/if}
				</button>
			{/if}
		{:else}
			<button class="back-btn" on:click={() => goto('/')}>
				トップページに戻る
			</button>
		{/if}
	</div>
</div>

<Footer />

<style>
	.container {
		padding: 28px 20px;
		max-width: 1200px;
		margin: 0 auto;
	}

	.success-message-container {
		margin-bottom: 32px;
	}

	.success-message {
		background: #e6f6e8;
		border: 2px solid #2d7a3e;
		border-radius: 12px;
		padding: 20px;
		display: flex;
		gap: 16px;
		align-items: flex-start;
	}

	.success-message.scheduled {
		background: #e8f4ff;
		border-color: #007bff;
	}

	.message-icon {
		font-size: 24px;
		flex-shrink: 0;
	}

	.message-content {
		flex: 1;
	}

	.message-title {
		font-size: 18px;
		font-weight: 700;
		margin: 0 0 8px 0;
		color: var(--primary-text);
	}

	.message-text {
		font-size: 14px;
		line-height: 1.6;
		margin: 0;
		color: var(--secondary-text);
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
		background: var(--accent-primary);
		color: white;
		font-size: 11px;
		padding: 2px 6px;
		border-radius: 4px;
		margin-left: 6px;
	}

	.plans-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 24px;
		margin-bottom: 60px;
		max-width: 1400px;
		margin-left: auto;
		margin-right: auto;
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
		border-color: #2d7a3e;
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
		border-radius: 100px;
		font-size: 13px;
		font-weight: 600;
	}

	.current-badge {
		position: absolute;
		top: -12px;
		left: 50%;
		transform: translateX(-50%);
		background: #2d7a3e;
		color: white;
		padding: 6px 16px;
		border-radius: 100px;
		font-size: 13px;
		font-weight: 600;
	}

	.plan-name {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 8px;
		color: var(--primary-text);
	}

	.plan-subtitle {
		font-size: 14px;
		color: var(--secondary-text);
		margin-bottom: 16px;
	}

	.price-section {
		margin-bottom: 16px;
		border-bottom: 1px solid var(--separator-gray);
		padding-bottom: 16px;
	}

	.max-members {
		font-size: 16px;
		font-weight: 600;
		color: var(--ios-blue);
		background: var(--bg-secondary);
		padding: 10px 16px;
		border-radius: 8px;
		text-align: center;
		margin-bottom: 24px;
	}

	.price {
		font-size: 36px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 8px;
	}

	.savings {
		font-size: 14px;
		color: var(--accent-primary);
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

	.comparison-section {
		margin-top: 60px;
		margin-bottom: 60px;
		padding: 0 0 40px 0;
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
		width: 40%;
	}

	.comparison-table th:nth-child(2),
	.comparison-table th:nth-child(3),
	.comparison-table th:nth-child(4),
	.comparison-table th:nth-child(5) {
		width: 15%;
		text-align: center;
	}

	.comparison-table td {
		padding: 16px;
		border-bottom: 1px solid var(--separator-gray);
		color: var(--primary-text);
	}

	.comparison-table td:nth-child(2),
	.comparison-table td:nth-child(3),
	.comparison-table td:nth-child(4),
	.comparison-table td:nth-child(5) {
		text-align: center;
	}

	.comparison-table tbody tr:last-child td {
		border-bottom: none;
	}

	.comparison-table td:first-child {
		font-weight: 600;
	}

	/* モバイル/デスクトップ切り替え（デフォルト: デスクトップ表示） */
	.mobile-only {
		display: none;
	}

	.desktop-only {
		display: block;
	}

	/* モバイル: カードレイアウト */
	.comparison-cards {
		display: grid;
		grid-template-columns: 1fr;
		gap: 24px;
		margin-top: 32px;
		margin-bottom: 32px;
	}

	.comparison-card {
		background: white;
		border: 2px solid var(--separator-gray);
		border-radius: 12px;
		padding: 20px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}

	.card-plan-name {
		font-size: 20px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 16px;
		padding-bottom: 12px;
		border-bottom: 2px solid var(--separator-gray);
	}

	.card-features {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.card-feature-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 0;
		border-bottom: 1px solid #f0f0f0;
	}

	.card-feature-row:last-child {
		border-bottom: none;
	}

	.card-label {
		font-size: 14px;
		font-weight: 600;
		color: var(--primary-text);
		flex: 1;
	}

	.card-value {
		font-size: 15px;
		color: var(--primary-text);
		font-weight: 500;
		text-align: right;
		min-width: 80px;
	}

	.back-button-section {
		margin-top: 60px;
		text-align: center;
	}

	.back-btn {
		background: white;
		color: var(--ios-blue);
		border: 2px solid var(--ios-blue);
		border-radius: 10px;
		padding: 14px 32px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.back-btn:hover {
		background: var(--ios-blue);
		color: white;
	}

	.back-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.back-btn.cancel {
		background: white;
		color: #dc3545;
		border: 2px solid #dc3545;
	}

	.back-btn.cancel:hover:not(:disabled) {
		background: #dc3545;
		color: white;
	}

	@media (max-width: 768px) {
		.title {
			font-size: 24px;
		}

		.plans-grid {
			grid-template-columns: 1fr;
		}

		/* モバイル: カード表示、テーブル非表示 */
		.mobile-only {
			display: block;
		}

		.desktop-only {
			display: none;
		}

		/* モバイル: カードレイアウトのgridを明示的に設定 */
		.comparison-cards.mobile-only {
			display: grid;
		}

		/* モバイル: 機能比較セクションの上下スペース調整 */
		.comparison-section {
			margin-top: 48px;
			margin-bottom: 48px;
			padding: 32px 0;
		}

		.comparison-title {
			margin-bottom: 24px;
		}
	}

	/* タブレット以上: テーブル表示、カード非表示 */
	@media (min-width: 769px) {
		.mobile-only {
			display: none;
		}

		.desktop-only {
			display: block;
		}
	}

	/* PC対応: デスクトップ（1200px以上）*/
	@media (min-width: 1200px) {
		.plans-grid {
			grid-template-columns: repeat(4, 1fr);
			max-width: 1400px;
		}
	}
</style>
