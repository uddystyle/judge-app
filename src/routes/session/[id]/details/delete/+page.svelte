<script lang="ts">
	import { goto } from '$app/navigation';
	import NavButton from '$lib/components/NavButton.svelte';
	import { page } from '$app/stores';

	let deleting = false;
	let errorMessage = '';

	async function handleDelete() {
		if (deleting) return;

		deleting = true;
		errorMessage = '';

		try {
			const response = await fetch(`/api/sessions/${$page.params.id}`, {
				method: 'DELETE'
			});

			const result = await response.json();

			if (!response.ok) {
				throw new Error(result.error || 'セッションの削除に失敗しました');
			}

			// 成功したらダッシュボードへリダイレクト
			goto('/dashboard');
		} catch (err: any) {
			errorMessage = err.message || 'セッションの削除に失敗しました';
		} finally {
			deleting = false;
		}
	}
</script>

<div class="container">
	<div class="instruction">本当にこのセッションを削除しますか？</div>
	<p class="warning-text">
		セッションはアーカイブに移動され、ダッシュボードからは非表示になります。
	</p>
	<p class="info-text">
		※ セッションデータは保持され、管理者はアーカイブから復元できます。
	</p>

	{#if errorMessage}
		<p class="message">{errorMessage}</p>
	{/if}

	<div class="nav-buttons">
		<NavButton variant="danger" on:click={handleDelete} disabled={deleting}>
			{deleting ? '削除中...' : 'はい、削除します'}
		</NavButton>

		<NavButton on:click={() => goto(`/session/${$page.params.id}/details`)} type="button" disabled={deleting}>
			いいえ、キャンセルします
		</NavButton>
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
		margin-bottom: 16px;
	}
	.warning-text {
		color: var(--secondary-text);
		margin-bottom: 12px;
		line-height: 1.6;
	}
	.info-text {
		color: var(--text-secondary);
		font-size: 14px;
		margin-bottom: 24px;
		line-height: 1.6;
		background: var(--bg-secondary);
		padding: 12px;
		border-radius: 8px;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.message {
		color: #dc3545;
		margin-top: 1rem;
	}
</style>
