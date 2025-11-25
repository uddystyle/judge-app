<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import type { ActionData, PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { goto } from '$app/navigation';

	export let form: ActionData;
	export let data: PageData;

	// プラン表示名と価格の定義
	const planInfo: Record<string, { name: string; price: string }> = {
		free: { name: 'フリー', price: '無料' },
		basic: { name: 'Basic', price: '¥8,800/月' },
		standard: { name: 'Standard', price: '¥24,800/月' },
		premium: { name: 'Premium', price: '¥49,800/月' }
	};

	// URLパラメータからクーポンコードを取得
	const couponCode = $page.url.searchParams.get('coupon');

	// ステップ管理: 0 = 選択画面, 1 = 組織名入力, 2 = プラン選択
	let step = 0;
	let organizationName = '';
	let selectedPlan = 'free';
</script>

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} hasOrganization={data.organizations && data.organizations.length > 0} pageOrganizations={data.organizations || []} />

<div class="container">
	{#if step === 0}
		<!-- Step 0: 選択画面 -->
		<div class="header">
			<h1 class="title welcome-title">TENTOへようこそ</h1>
			<p class="subtitle">
				次のステップを選択してください
			</p>
		</div>

		<div class="choice-container">
			<button class="choice-card" on:click={() => (step = 1)}>
				<h2 class="choice-title">組織を作成する</h2>
				<p class="choice-description">
					スキークラブや団体として<br />
					セッションを管理します
				</p>
			</button>

			<button class="choice-card secondary" on:click={() => goto('/organization/join')}>
				<h2 class="choice-title">組織に参加する</h2>
				<p class="choice-description">
					招待コードを使って<br />
					既存の組織に参加します
				</p>
			</button>
		</div>

		<div class="info-note">
			<p>組織を作成すると、セッションの作成や管理ができるようになります。</p>
			<p>組織に参加する場合は、組織の管理者から招待コードを受け取ってください。</p>
		</div>
	{:else if step === 1}
		<!-- Step 1: 組織名入力 -->
		<div class="header">
			<h1 class="title">組織を作成</h1>
			<p class="subtitle">
				TENTOでは、すべてのセッションは組織に属します。<br />
				まずは組織名を入力してください。
			</p>
		</div>

		<div class="form-container">
			<div class="input-group">
				<label for="organization-name">組織名</label>
				<input
					type="text"
					name="organizationName"
					id="organization-name"
					placeholder="例: 〇〇スキークラブ"
					bind:value={organizationName}
					required
				/>
				<p class="help-text">
					組織名はいつでも変更できます。<br />
					個人でご利用の場合は、ご自身の名前でも構いません。
				</p>
			</div>

			{#if form?.error}
				<div class="error-container">
					<p class="error-message">{form.error}</p>
				</div>
			{/if}

			<div class="nav-buttons">
				<NavButton variant="secondary" on:click={() => (step = 0)}>
					戻る
				</NavButton>
				<NavButton variant="primary" on:click={() => (step = 2)} disabled={!organizationName.trim()}>
					次へ進む
				</NavButton>
			</div>
		</div>
	{:else}
		<!-- Step 2: プラン選択 -->
		<div class="header">
			<h1 class="title">プランを選択</h1>
			<p class="subtitle">
				TENTOでは、組織ごとにプランを設定します。<br />
				プランを選択してください。
			</p>
			{#if couponCode}
				<div class="coupon-badge">
					<span class="coupon-icon">🎟️</span>
					<span class="coupon-text">クーポン適用: {couponCode}</span>
				</div>
			{/if}
		</div>

		<div class="selected-org-info">
			<div class="info-label">組織名:</div>
			<div class="info-value">{organizationName}</div>
		</div>

		<form method="POST" action="?/create" use:enhance>
			<input type="hidden" name="organizationName" value={organizationName} />
			<input type="hidden" name="planType" value={selectedPlan} />
			{#if couponCode}
				<input type="hidden" name="couponCode" value={couponCode} />
			{/if}

			<div class="plan-selection">
				<div class="plans-grid">
					{#each data.plans as plan}
						<label class="plan-card" class:selected={selectedPlan === plan.plan_type}>
							<input
								type="radio"
								name="planSelection"
								value={plan.plan_type}
								bind:group={selectedPlan}
							/>
							<div class="plan-header">
								<div class="plan-name">{planInfo[plan.plan_type]?.name || plan.plan_type}</div>
								<div class="plan-price">{planInfo[plan.plan_type]?.price || ''}</div>
							</div>
							<div class="plan-features">
								<div class="feature">
									<span class="feature-label">組織メンバー:</span>
									<span class="feature-value">
										{plan.max_organization_members === -1
											? '無制限'
											: `${plan.max_organization_members}人`}
									</span>
								</div>
								<div class="feature">
									<span class="feature-label">検定員:</span>
									<span class="feature-value">
										{plan.max_judges_per_session === -1
											? '無制限'
											: `${plan.max_judges_per_session}人`}
									</span>
								</div>
								<div class="feature">
									<span class="feature-label">セッション:</span>
									<span class="feature-value">
										{plan.max_sessions_per_month === -1
											? '無制限'
											: `月${plan.max_sessions_per_month}回`}
									</span>
								</div>
								<div class="feature">
									<span class="feature-label">大会モード:</span>
									<span class="feature-value">{plan.has_tournament_mode ? '✓' : '×'}</span>
								</div>
								<div class="feature">
									<span class="feature-label">研修モード:</span>
									<span class="feature-value">{plan.has_training_mode ? '✓' : '×'}</span>
								</div>
							</div>
						</label>
					{/each}
				</div>

				<p class="plan-note">
					{#if selectedPlan !== 'free'}
						組織作成後、決済画面に進みます。
					{:else}
						フリープランで開始します。後からいつでもプランをアップグレードできます。
					{/if}
				</p>

				{#if form?.error}
					<div class="error-container">
						<p class="error-message">{form.error}</p>
					</div>
				{/if}

				<div class="nav-buttons">
					<NavButton variant="secondary" on:click={() => (step = 1)}> 組織名を変更 </NavButton>
					<NavButton variant="primary" type="submit">
						{#if selectedPlan !== 'free'}
							組織を作成して決済へ進む
						{:else}
							組織を作成してはじめる
						{/if}
					</NavButton>
				</div>
			</div>
		</form>
	{/if}
</div>

<Footer />

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 480px;
		margin: 0 auto;
		min-height: calc(100vh - 60px);
	}

	.header {
		margin-bottom: 32px;
	}

	.title {
		font-size: 28px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 12px;
	}

	.app-name {
		font-family: 'M PLUS Rounded 1c', sans-serif;
		font-weight: 800;
		letter-spacing: 0.05em;
	}

	.welcome-title {
		font-family: 'M PLUS Rounded 1c', sans-serif;
		font-weight: 800;
		letter-spacing: 0.05em;
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

	.form-container {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.input-group {
		text-align: left;
	}

	.input-group label {
		display: block;
		font-size: 15px;
		font-weight: 600;
		color: var(--primary-text);
		margin-bottom: 8px;
	}

	.input-group input {
		width: 100%;
		background: #fff;
		border: 2px solid var(--separator-gray);
		border-radius: 12px;
		padding: 15px;
		font-size: 16px;
		transition: all 0.2s;
	}

	.input-group input:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px rgba(23, 23, 23, 0.1);
	}

	.help-text {
		font-size: 13px;
		color: var(--secondary-text);
		margin-top: 8px;
		line-height: 1.5;
	}

	.plan-selection {
		text-align: left;
	}

	.plans-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
		margin-bottom: 12px;
	}

	.plan-card {
		background: white;
		border: 2px solid var(--separator-gray);
		border-radius: 12px;
		padding: 16px;
		cursor: pointer;
		transition: all 0.2s;
		position: relative;
	}

	.plan-card:hover {
		border-color: var(--accent-primary);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.plan-card.selected {
		border-color: var(--accent-primary);
		background: var(--bg-tertiary);
		box-shadow: 0 2px 12px rgba(23, 23, 23, 0.15);
	}

	.plan-card input[type='radio'] {
		position: absolute;
		top: 12px;
		right: 12px;
		width: 20px;
		height: 20px;
		cursor: pointer;
	}

	.plan-header {
		margin-bottom: 12px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--separator-gray);
	}

	.plan-name {
		font-size: 18px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 4px;
	}

	.plan-price {
		font-size: 16px;
		font-weight: 600;
		color: var(--accent-primary);
	}

	.plan-features {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.feature {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
	}

	.feature-label {
		color: var(--secondary-text);
	}

	.feature-value {
		color: var(--primary-text);
		font-weight: 600;
	}

	.plan-note {
		font-size: 13px;
		color: var(--secondary-text);
		margin: 0;
		padding: 12px;
		background: var(--bg-secondary);
		border-radius: 8px;
	}

	.selected-org-info {
		background: var(--bg-tertiary);
		border: 2px solid var(--border-medium);
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 24px;
		text-align: left;
	}

	.info-label {
		font-size: 13px;
		color: var(--secondary-text);
		margin-bottom: 4px;
	}

	.info-value {
		font-size: 18px;
		font-weight: 700;
		color: var(--text-primary);
	}

	.error-container {
		background: #fee;
		border: 2px solid #dc3545;
		border-radius: 12px;
		padding: 16px;
		text-align: center;
	}

	.error-message {
		color: #dc3545;
		font-size: 14px;
		margin: 0;
	}

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 8px;
	}

	.choice-container {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-bottom: 32px;
	}

	.choice-card {
		position: relative;
		background: white;
		border: 3px solid var(--separator-gray);
		border-radius: 16px;
		padding: 32px 24px;
		cursor: pointer;
		transition: all 0.3s ease;
		text-align: center;
		width: 100%;
	}

	.choice-card:hover {
		border-color: var(--ios-blue);
		box-shadow: 0 8px 24px rgba(0, 122, 255, 0.15);
		transform: translateY(-4px);
	}

	.choice-card:active {
		transform: translateY(-2px);
	}

	.choice-card.secondary {
		border-color: var(--border-light);
	}

	.choice-card.secondary:hover {
		border-color: var(--secondary-text);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
	}

	.choice-title {
		font-size: 20px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 12px;
	}

	.choice-description {
		font-size: 15px;
		color: var(--text-secondary);
		line-height: 1.6;
		margin: 0;
	}

	.choice-badge {
		position: absolute;
		top: 16px;
		right: 16px;
		background: var(--ios-blue);
		color: white;
		font-size: 12px;
		font-weight: 700;
		padding: 4px 12px;
		border-radius: 12px;
		letter-spacing: 0.05em;
	}

	.info-note {
		background: var(--bg-secondary);
		border-radius: 12px;
		padding: 20px;
		text-align: center;
	}

	.info-note p {
		font-size: 14px;
		color: var(--text-secondary);
		line-height: 1.7;
		margin: 0 0 8px 0;
	}

	.info-note p:last-child {
		margin-bottom: 0;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 900px;
		}

		.title {
			font-size: 36px;
			margin-bottom: 16px;
		}

		.subtitle {
			font-size: 17px;
		}

		.input-group input {
			padding: 18px;
			font-size: 18px;
		}

		.plans-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 16px;
		}

		.plan-card {
			padding: 20px;
		}

		.plan-name {
			font-size: 20px;
		}

		.plan-price {
			font-size: 18px;
		}

		.feature {
			font-size: 14px;
		}

		.choice-container {
			flex-direction: row;
			gap: 24px;
		}

		.choice-title {
			font-size: 22px;
		}

		.choice-description {
			font-size: 16px;
		}

		.info-note {
			padding: 24px;
		}

		.info-note p {
			font-size: 15px;
		}
	}

	@media (min-width: 1024px) {
		.plans-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}
</style>
