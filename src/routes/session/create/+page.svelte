<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';

	// This `form` variable will hold the data returned from the server action
	export let form: ActionData;
</script>

<Header />

<div class="container">
	<div class="instruction">新しい検定を作成</div>

	<form method="POST" action="?/create" use:enhance>
		<div class="form-container">
			<input
				type="text"
				name="sessionName"
				id="session-name-input"
				placeholder="検定名 (例: 2025冬期検定)"
				value={form?.sessionName ?? ''}
			/>

			{#if form?.error}
				<p class="error-message">{form.error}</p>
			{/if}

			<div class="nav-buttons">
				<NavButton variant="primary" type="submit">作成</NavButton>
			</div>
		</div>
	</form>

	<div class="nav-buttons">
		<NavButton on:click={() => goto('/dashboard')}>戻る</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 400px;
		margin: 0 auto;
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
		background: #fff;
		border: 1px solid var(--separator-gray);
		border-radius: 12px;
		padding: 15px;
		font-size: 16px;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.error-message {
		color: var(--ios-red);
		font-size: 14px;
	}
</style>
