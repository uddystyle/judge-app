<script lang="ts">
	import { enhance } from '$app/forms';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import type { PageData, ActionData } from './$types';

	export let data: PageData;
	export let form: ActionData;

	let loading = false;

	const planNames: Record<string, string> = {
		basic: 'Basic',
		standard: 'Standard',
		premium: 'Premium'
	};

	const roleNames: Record<string, string> = {
		admin: '管理者',
		member: 'メンバー'
	};
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
	<div class="invitation-header">
		<h1 class="page-title">組織への招待</h1>
		<p class="subtitle">あなたは組織に招待されています</p>
	</div>

	<!-- 組織情報 -->
	<div class="organization-card">
		<h2 class="org-name">{data.organization.name}</h2>
		<div class="org-meta">
			<span class="plan-badge">{planNames[data.organization.plan_type]}</span>
			<span class="role-info">役割: {roleNames[data.invitation.role]}</span>
		</div>
	</div>

	{#if form?.error}
		<div class="error-message">{form.error}</div>
	{/if}

	{#if data.isLoggedIn}
		<!-- すでにログイン済みの場合 -->
		<div class="section">
			<p class="help-text">ログイン中です。下のボタンをクリックして組織に参加してください。</p>
			<form method="POST" action="?/join" use:enhance={() => {
				loading = true;
				return async ({ update }) => {
					await update();
					loading = false;
				};
			}}>
				<div class="nav-buttons">
					<NavButton variant="primary" type="submit" disabled={loading}>
						{loading ? '処理中...' : '組織に参加'}
					</NavButton>
				</div>
			</form>
		</div>
	{:else}
		<!-- 未ログインの場合：新規登録フォーム -->
		<div class="section">
			<h3 class="section-title">アカウントを作成して参加</h3>
			<form method="POST" action="?/signup" use:enhance={() => {
				loading = true;
				return async ({ update }) => {
					await update();
					loading = false;
				};
			}}>
				<div class="form-group">
					<label for="fullName" class="form-label">氏名</label>
					<input
						type="text"
						id="fullName"
						name="fullName"
						required
						class="input-field"
						placeholder="山田 太郎"
						disabled={loading}
					/>
				</div>

				<div class="form-group">
					<label for="email" class="form-label">メールアドレス</label>
					<input
						type="email"
						id="email"
						name="email"
						required
						class="input-field"
						placeholder="example@example.com"
						disabled={loading}
					/>
				</div>

				<div class="form-group">
					<label for="password" class="form-label">パスワード</label>
					<input
						type="password"
						id="password"
						name="password"
						required
						class="input-field"
						placeholder="8文字以上"
						minlength="8"
						disabled={loading}
					/>
				</div>

				<div class="nav-buttons">
					<NavButton variant="primary" type="submit" disabled={loading}>
						{loading ? '処理中...' : '登録して参加'}
					</NavButton>
				</div>
			</form>

			<hr class="divider" />

			<div class="login-section">
				<p class="help-text">すでにアカウントをお持ちの場合</p>
				<div class="nav-buttons">
					<NavButton on:click={() => window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`}>
						ログイン
					</NavButton>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.container {
		padding: 50px 20px 60px;
		max-width: 600px;
		margin: 0 auto;
		min-height: calc(100vh - 80px);
	}
	.invitation-header {
		text-align: center;
		margin-bottom: 40px;
	}
	.page-title {
		font-size: 32px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 12px;
	}
	.subtitle {
		font-size: 16px;
		color: var(--text-secondary);
		margin: 0;
	}
	.organization-card {
		background: linear-gradient(135deg, var(--primary-orange) 0%, var(--primary-orange-light) 100%);
		color: white;
		padding: 32px;
		border-radius: 20px;
		text-align: center;
		margin-bottom: 32px;
		box-shadow: 0 8px 24px rgba(255, 107, 53, 0.3);
	}
	.org-name {
		font-size: 28px;
		font-weight: 700;
		margin: 0 0 16px 0;
	}
	.org-meta {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 16px;
		flex-wrap: wrap;
		font-size: 14px;
	}
	.plan-badge {
		background: white;
		color: var(--primary-orange);
		padding: 6px 14px;
		border-radius: 8px;
		font-weight: 600;
	}
	.role-info {
		font-weight: 500;
	}
	.section {
		margin-bottom: 32px;
	}
	.section-title {
		font-size: 20px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 20px;
		text-align: center;
	}
	.form-group {
		margin-bottom: 20px;
	}
	.form-label {
		display: block;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 8px;
	}
	.input-field {
		width: 100%;
		padding: 14px;
		font-size: 16px;
		border: 2px solid var(--border-light);
		border-radius: 12px;
		background: var(--bg-white);
		color: var(--text-primary);
		transition: all 0.2s;
		box-sizing: border-box;
	}
	.input-field:focus {
		outline: none;
		border-color: var(--primary-orange);
		box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.1);
	}
	.input-field:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.help-text {
		font-size: 14px;
		color: var(--text-secondary);
		text-align: center;
		margin: 0 0 20px 0;
	}
	.error-message {
		background: #fff5f5;
		color: var(--ios-red);
		padding: 16px;
		border-radius: 12px;
		border: 2px solid #ffdddd;
		text-align: center;
		margin-bottom: 24px;
		font-size: 14px;
		font-weight: 500;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.divider {
		border: none;
		border-top: 1px solid var(--separator-gray);
		margin: 32px 0;
	}
	.login-section {
		text-align: center;
	}

	@media (min-width: 768px) {
		.container {
			padding: 60px 40px 80px;
		}
		.page-title {
			font-size: 36px;
		}
		.organization-card {
			padding: 40px;
		}
		.org-name {
			font-size: 32px;
		}
	}
</style>
