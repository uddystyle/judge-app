<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';

	export let form: ActionData;
</script>

<div class="container">
	<div class="instruction">新規アカウント登録</div>

	<form method="POST" action="?/signup" use:enhance>
		<div class="form-container">
			<input
				type="text"
				name="fullName"
				placeholder="氏名"
				autocomplete="name"
				value={form?.fullName ?? ''}
				required
			/>
			<input
				type="email"
				name="email"
				placeholder="メールアドレス"
				autocomplete="email"
				value={form?.email ?? ''}
				required
			/>
			<input
				type="password"
				name="password"
				placeholder="パスワード (6文字以上)"
				autocomplete="new-password"
				required
			/>

			{#if form?.error}
				<p class="error-message">{form.error}</p>
			{/if}

			<div class="nav-buttons">
				<NavButton variant="primary" type="submit">登録する</NavButton>
			</div>
		</div>
	</form>

	<div class="nav-buttons">
		<NavButton on:click={() => goto('/login')}>ログイン画面に戻る</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 60px 20px;
		text-align: center;
		max-width: 440px;
		margin: 0 auto;
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}
	.instruction {
		font-size: 32px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 40px;
	}
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 16px;
		background: var(--bg-white);
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
		background: var(--bg-white);
		color: var(--text-primary);
		transition: all 0.2s;
	}
	.form-container input:focus {
		outline: none;
		border-color: var(--primary-orange);
		box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.1);
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 8px;
	}
	.error-message {
		color: var(--ios-red);
		font-size: 14px;
		margin: 0;
		padding: 12px;
		background: #fff5f5;
		border-radius: 8px;
		border: 1px solid #ffdddd;
	}
</style>
