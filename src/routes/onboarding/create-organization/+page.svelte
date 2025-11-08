<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
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

	let selectedPlan = 'free';
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
		<h1 class="title">組織を作成</h1>
		<p class="subtitle">
			TENTOでは、すべてのセッションは組織に属します。<br />
			まずは組織を作成してください。
		</p>
	</div>

	<form method="POST" action="?/create" use:enhance>
		<div class="form-container">
			<div class="input-group">
				<label for="organization-name">組織名</label>
				<input
					type="text"
					name="organizationName"
					id="organization-name"
					placeholder="例: 〇〇スキークラブ"
					value={form?.organizationName ?? ''}
					required
				/>
				<p class="help-text">
					組織名はいつでも変更できます。<br />
					個人でご利用の場合は、ご自身の名前でも構いません。
				</p>
			</div>

			<div class="plan-selection">
				<h3>プランを選択</h3>
				<input type="hidden" name="planType" value={selectedPlan} />

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
										{plan.max_organization_members === -1 ? '無制限' : `${plan.max_organization_members}人`}
									</span>
								</div>
								<div class="feature">
									<span class="feature-label">検定員:</span>
									<span class="feature-value">
										{plan.max_judges_per_session === -1 ? '無制限' : `${plan.max_judges_per_session}人`}
									</span>
								</div>
								<div class="feature">
									<span class="feature-label">セッション:</span>
									<span class="feature-value">
										{plan.max_sessions_per_month === -1 ? '無制限' : `月${plan.max_sessions_per_month}回`}
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
						有料プランを選択した場合、組織作成後に決済情報の入力が必要です。
					{:else}
						後からプランをアップグレードできます。
					{/if}
				</p>
			</div>

			{#if form?.error}
				<div class="error-container">
					<p class="error-message">{form.error}</p>
				</div>
			{/if}

			<div class="nav-buttons">
				<NavButton variant="primary" type="submit">組織を作成してはじめる</NavButton>
			</div>
		</div>
	</form>

	<div class="nav-buttons" style="margin-top: 16px;">
		<NavButton on:click={() => goto('/dashboard')}>セッション画面に戻る</NavButton>
	</div>
</div>

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

	.subtitle {
		font-size: 15px;
		color: var(--secondary-text);
		line-height: 1.6;
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
		border-color: var(--primary-orange);
		box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.1);
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

	.plan-selection h3 {
		font-size: 16px;
		font-weight: 600;
		color: var(--primary-text);
		margin-bottom: 16px;
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
		border-color: var(--primary-orange);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.plan-card.selected {
		border-color: var(--primary-orange);
		background: #fff8f5;
		box-shadow: 0 2px 12px rgba(255, 107, 53, 0.15);
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
		color: var(--primary-orange);
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
		background: var(--bg-beige);
		border-radius: 8px;
	}

	.error-container {
		background: #fee;
		border: 2px solid var(--ios-red);
		border-radius: 12px;
		padding: 16px;
		text-align: center;
	}

	.error-message {
		color: var(--ios-red);
		font-size: 14px;
		margin: 0;
	}

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 8px;
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
	}

	@media (min-width: 1024px) {
		.plans-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}
</style>
