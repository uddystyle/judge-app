<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import type { PageData, ActionData } from './$types';

	export let data: PageData;
	export let form: ActionData;

	let loading = false;

	// URLパラメータからのメッセージ（auth/callback 等からのリダイレクト時）
	$: urlError = $page.url.searchParams.get('error') ?? '';
	$: successMessage =
		$page.url.searchParams.get('success') === 'password-reset' ? m.auth_passwordResetSuccess() : '';

	// 表示するエラー：サーバーアクションの結果を優先、無ければURLパラメータ
	$: errorMessage = form?.error ?? urlError;

	// ログインはサーバーアクションで実行（レート制限が適用される）。
	// 成功時はサーバーが 303 リダイレクトするため enhance がそのまま遷移する。
	const handleEnhance = () => {
		loading = true;
		return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
			// reset:false で入力値（メール）を保持。失敗時は form 更新でエラー表示。
			await update({ reset: false });
			loading = false;
		};
	};
</script>

<Header showAppName={true} pageUser={null} />

<div class="container">
	<div class="instruction">{m.auth_loginTitle()}</div>

	<form class="form-container" method="POST" use:enhance={handleEnhance}>
		<input type="hidden" name="next" value={data.next ?? '/dashboard'} />
		<input
			type="email"
			name="email"
			autocomplete="email"
			value={form?.email ?? ''}
			placeholder={m.auth_email()}
			class="input-field"
			disabled={loading}
			required
		/>
		<input
			type="password"
			name="password"
			autocomplete="current-password"
			placeholder={m.auth_password()}
			class="input-field"
			disabled={loading}
			required
		/>

		{#if successMessage}
			<p class="success-message">{successMessage}</p>
		{/if}

		{#if errorMessage}
			<p class="error-message">{errorMessage}</p>
		{/if}

		<div class="forgot-password-link">
			<a href="/reset-password">{m.auth_forgotPassword()}</a>
		</div>

		<div class="nav-buttons">
			<NavButton variant="primary" type="submit" disabled={loading}>
				{#if loading}
					<span style="display: inline-flex; align-items: center; gap: 8px;">
						{m.auth_loggingIn()}
						<LoadingSpinner size="small" inline={true} />
					</span>
				{:else}
					{m.common_login()}
				{/if}
			</NavButton>
			<NavButton type="button" on:click={() => goto('/signup')}>{m.auth_newRegistration()}</NavButton>
		</div>
	</form>

	<div class="nav-buttons" style="margin-top: 16px;">
		<NavButton on:click={() => goto('/')}>{m.nav_topPage()}</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 440px;
		margin: 0 auto;
		min-height: calc(100vh - 80px);
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 28px;
	}
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 16px;
		background: var(--bg-primary);
		padding: 24px;
		border-radius: 16px;
		border: 2px solid var(--border-light);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
	}
	.input-field {
		padding: 15px;
		font-size: 16px;
		border: 2px solid var(--border-light);
		border-radius: 12px;
		background: var(--bg-primary);
		color: var(--text-primary);
		transition: all 0.2s;
	}
	.input-field:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.1);
	}
	.success-message {
		color: #10b981;
		font-size: 14px;
		margin: 0;
		padding: 12px;
		background: #f0fdf4;
		border-radius: 8px;
		border: 1px solid #bbf7d0;
	}
	.error-message {
		color: #dc3545;
		font-size: 14px;
		margin: 0;
		padding: 12px;
		background: #fff5f5;
		border-radius: 8px;
		border: 1px solid #ffdddd;
	}
	.forgot-password-link {
		text-align: right;
		margin-top: -8px;
	}
	.forgot-password-link a {
		color: var(--accent-primary);
		font-size: 14px;
		text-decoration: none;
		transition: color 0.2s;
	}
	.forgot-password-link a:hover {
		color: var(--accent-hover);
		text-decoration: underline;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 8px;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 500px;
		}
		.instruction {
			font-size: 36px;
			margin-bottom: 40px;
		}
		.form-container {
			padding: 40px;
			gap: 20px;
		}
		.input-field {
			padding: 18px;
			font-size: 18px;
		}
		.success-message {
			font-size: 15px;
			padding: 14px;
		}
		.error-message {
			font-size: 15px;
			padding: 14px;
		}
		.forgot-password-link a {
			font-size: 15px;
		}
	}
</style>
