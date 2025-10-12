<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import NavButton from '$lib/components/NavButton.svelte';
	import { page } from '$app/stores';

	export let form: any;
</script>

<div class="container">
	<div class="instruction">本当にこの検定を削除しますか？</div>
	<p class="warning-text">
		この操作は取り消せません。この検定に関連する全ての採点データが完全に削除されます。
	</p>

	{#if form?.error}
		<p class="message">{form.error}</p>
	{/if}

	<form method="POST" action="/session/{$page.params.id}/details?/deleteSession" use:enhance>
		<div class="nav-buttons">
			<NavButton variant="danger" type="submit">はい、削除します</NavButton>

			<NavButton on:click={() => window.history.back()} type="button">
				いいえ、キャンセルします
			</NavButton>
		</div>
	</form>
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
		margin-bottom: 16px;
	}
	.warning-text {
		color: var(--secondary-text);
		margin-bottom: 24px;
		line-height: 1.6;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.message {
		color: var(--ios-red);
		margin-top: 1rem;
	}
</style>
