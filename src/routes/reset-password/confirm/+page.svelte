<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { ActionData, PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	export let data: PageData;
	export let form: ActionData;

	let password = '';
	let confirmPassword = '';
	let loading = false;
	let showPassword = false;
	let showConfirmPassword = false;
</script>

<Header showAppName={true} pageUser={null} />

<div class="container">
	<div class="instruction">新しいパスワード設定</div>

	{#if data.error}
		<div class="error-container">
			<div class="error-icon">
				<svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
					<circle cx="12" cy="12" r="10" stroke="#dc3545" stroke-width="2" fill="none"/>
					<path d="M12 8V12M12 16H12.01" stroke="#dc3545" stroke-width="2" stroke-linecap="round"/>
				</svg>
			</div>
			<h2 class="error-title">リンクが無効です</h2>
			<p class="error-text">{data.error}</p>
			<div class="nav-buttons">
				<NavButton variant="primary" on:click={() => goto('/reset-password')}>
					再度リセットを試す
				</NavButton>
				<NavButton on:click={() => goto('/login')}>
					ログインページに戻る
				</NavButton>
			</div>
		</div>
	{:else}
		<div class="form-container">
			<p class="description">
				新しいパスワードを入力してください。<br/>
				パスワードは6文字以上72文字以内で設定してください。
			</p>

			<form method="POST" use:enhance={() => {
				loading = true;
				return async ({ update }) => {
					await update();
					loading = false;
				};
			}}>
				<div class="password-field-wrapper">
					<input
						type={showPassword ? 'text' : 'password'}
						name="password"
						bind:value={password}
						placeholder="新しいパスワード"
						class="input-field"
						disabled={loading}
						required
					/>
					<button
						type="button"
						class="toggle-password"
						on:click={() => showPassword = !showPassword}
						aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
					>
						{#if showPassword}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
								<path d="M3 3L21 21M10.5 10.677A2 2 0 1013.323 13.5M7.362 7.561C5.68 8.74 4.279 10.42 3 12c1.889 2.991 5.282 6 9 6 1.55 0 3.043-.408 4.452-1.088M16.638 16.439C18.32 15.26 19.721 13.58 21 12c-1.889-2.991-5.282-6-9-6-1.55 0-3.043.408-4.452 1.088" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
							</svg>
						{:else}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
								<path d="M12 5C7.588 5 3.988 7.648 2 12c1.988 4.352 5.588 7 10 7s8.012-2.648 10-7c-1.988-4.352-5.588-7-10-7z" stroke="currentColor" stroke-width="2"/>
								<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
							</svg>
						{/if}
					</button>
				</div>

				<div class="password-field-wrapper">
					<input
						type={showConfirmPassword ? 'text' : 'password'}
						name="confirmPassword"
						bind:value={confirmPassword}
						placeholder="新しいパスワード（確認）"
						class="input-field"
						disabled={loading}
						required
					/>
					<button
						type="button"
						class="toggle-password"
						on:click={() => showConfirmPassword = !showConfirmPassword}
						aria-label={showConfirmPassword ? 'パスワードを隠す' : 'パスワードを表示'}
					>
						{#if showConfirmPassword}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
								<path d="M3 3L21 21M10.5 10.677A2 2 0 1013.323 13.5M7.362 7.561C5.68 8.74 4.279 10.42 3 12c1.889 2.991 5.282 6 9 6 1.55 0 3.043-.408 4.452-1.088M16.638 16.439C18.32 15.26 19.721 13.58 21 12c-1.889-2.991-5.282-6-9-6-1.55 0-3.043.408-4.452 1.088" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
							</svg>
						{:else}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
								<path d="M12 5C7.588 5 3.988 7.648 2 12c1.988 4.352 5.588 7 10 7s8.012-2.648 10-7c-1.988-4.352-5.588-7-10-7z" stroke="currentColor" stroke-width="2"/>
								<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
							</svg>
						{/if}
					</button>
				</div>

				{#if form?.error}
					<p class="error-message">{form.error}</p>
				{/if}

				<div class="nav-buttons">
					<NavButton variant="primary" type="submit" disabled={loading}>
						{#if loading}
							<span style="display: inline-flex; align-items: center; gap: 8px;">
								更新中
								<LoadingSpinner size="small" inline={true} />
							</span>
						{:else}
							パスワードを更新
						{/if}
					</NavButton>
					<NavButton on:click={() => goto('/login')}>ログインページに戻る</NavButton>
				</div>
			</form>
		</div>
	{/if}
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
		padding: 24px;
		border-radius: 16px;
		border: 2px solid var(--border-light);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
	}
	.password-field-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}
	.input-field {
		width: 100%;
		padding: 15px;
		padding-right: 48px;
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
	.toggle-password {
		position: absolute;
		right: 12px;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-tertiary);
		transition: color 0.2s;
	}
	.toggle-password:hover {
		color: var(--text-secondary);
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

	.error-container {
		background: var(--bg-primary);
		padding: 32px 24px;
		border-radius: 16px;
		border: 2px solid #ffdddd;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
	}
	.error-icon {
		margin: 0 auto 20px;
		display: flex;
		justify-content: center;
	}
	.error-title {
		font-size: 20px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 16px;
	}
	.error-text {
		font-size: 14px;
		color: var(--text-secondary);
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
			font-size: 16px;
			margin-bottom: 24px;
		}
		.form-container {
			padding: 40px;
			gap: 20px;
		}
		.input-field {
			padding: 18px;
			padding-right: 52px;
			font-size: 18px;
		}
		.error-message {
			font-size: 15px;
			padding: 14px;
		}
		.error-container {
			padding: 48px 40px;
		}
		.error-title {
			font-size: 24px;
		}
		.error-text {
			font-size: 16px;
		}
	}
</style>
