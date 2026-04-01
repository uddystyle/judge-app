<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import * as m from '$lib/paraglide/messages.js';

	export let form: ActionData;

	let email = form?.email || '';
	let loading = false;
</script>

<Header showAppName={true} pageUser={null} />

<div class="container">
	<div class="instruction">パスワードリセット</div>

	{#if form?.success}
		<div class="success-container">
			<div class="success-icon">
				<svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
					<circle cx="12" cy="12" r="10" stroke="#10b981" stroke-width="2" fill="none"/>
					<path d="M8 12L11 15L16 9" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
			</div>
			<h2 class="success-title">メールを送信しました</h2>
			<p class="success-message">
				<strong>{form.email}</strong> にパスワードリセット用のリンクを送信しました。<br/>
				メールをご確認ください。
			</p>
			<p class="success-note">
				メールが届かない場合は、迷惑メールフォルダをご確認ください。<br/>
				リンクの有効期限は1時間です。
			</p>
			<div class="nav-buttons">
				<NavButton variant="primary" on:click={() => goto('/login')}>
					ログインページに戻る
				</NavButton>
			</div>
		</div>
	{:else}
		<p class="description">
			登録されているメールアドレスを入力してください。<br/>
			パスワードリセット用のリンクをお送りします。
		</p>

		<form method="POST" use:enhance={() => {
			loading = true;
			return async ({ update }) => {
				await update();
				loading = false;
			};
		}}>
			<div class="form-container">
				<input
					type="email"
					name="email"
					bind:value={email}
					placeholder={m.auth_email()}
					autocomplete="email"
					disabled={loading}
					required
				/>

				{#if form?.error}
					<p class="error-message">{form.error}</p>
				{/if}

				<div class="nav-buttons">
					<NavButton variant="primary" type="submit" disabled={loading}>
						{#if loading}
							<span style="display: inline-flex; align-items: center; gap: 8px;">
								送信中
								<LoadingSpinner size="small" inline={true} />
							</span>
						{:else}
							リセットリンクを送信
						{/if}
					</NavButton>
				</div>
			</div>
		</form>

		<div class="nav-buttons">
			<NavButton on:click={() => goto('/login')}>ログインページに戻る</NavButton>
		</div>
	{/if}
</div>

<style>
	.container {
		padding: 50px 20px 60px;
		text-align: center;
		max-width: 440px;
		margin: 0 auto;
		min-height: calc(100vh - 80px);
	}
	.instruction {
		font-size: 32px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 40px;
	}
	.description {
		font-size: 14px;
		color: var(--text-secondary);
		margin-bottom: 20px;
		line-height: 1.6;
	}
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 16px;
		background: var(--bg-primary);
		padding: 32px;
		border-radius: 20px;
		border: 2px solid var(--border-light);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
		margin-bottom: 16px;
	}
	.form-container input {
		padding: 16px;
		font-size: 17px;
		border: 2px solid var(--border-light);
		border-radius: 12px;
		background: var(--bg-primary);
		color: var(--text-primary);
		transition: all 0.2s;
	}
	.form-container input:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.1);
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
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 8px;
	}

	.success-container {
		background: var(--bg-primary);
		padding: 32px 24px;
		border-radius: 20px;
		border: 2px solid var(--border-light);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
	}
	.success-icon {
		margin: 0 auto 20px;
		display: flex;
		justify-content: center;
	}
	.success-title {
		font-size: 20px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 16px;
	}
	.success-message {
		font-size: 14px;
		color: var(--text-secondary);
		line-height: 1.6;
		margin-bottom: 16px;
	}
	.success-note {
		font-size: 13px;
		color: var(--text-tertiary);
		line-height: 1.6;
		margin-bottom: 24px;
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
		.description {
			font-size: 15px;
			margin-bottom: 24px;
		}
		.form-container {
			padding: 40px;
			gap: 20px;
		}
		.form-container input {
			padding: 18px;
			font-size: 18px;
		}
		.error-message {
			font-size: 15px;
			padding: 14px;
		}
		.success-container {
			padding: 48px 40px;
		}
		.success-title {
			font-size: 24px;
		}
		.success-message {
			font-size: 16px;
		}
		.success-note {
			font-size: 14px;
		}
	}
</style>
