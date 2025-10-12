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
		padding: 28px 20px;
		text-align: center;
		max-width: 400px;
		margin: 40px auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 28px;
	}
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.form-container input {
		padding: 15px;
		font-size: 17px;
		border: 1px solid var(--separator-gray);
		border-radius: 12px;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.error-message {
		color: var(--ios-red);
	}
</style>
