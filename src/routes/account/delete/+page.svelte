<script lang="ts">
	import { goto } from '$app/navigation';
	import NavButton from '$lib/components/NavButton.svelte';
	import { getContext } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';

	const supabase = getContext<SupabaseClient>('supabase');
	let loading = false;
	let message = '';

	async function handleDeleteAccount() {
		loading = true;
		message = '';

		// Get the current session to retrieve the access token
		const {
			data: { session }
		} = await supabase.auth.getSession();

		if (!session) {
			message = 'エラー: 認証されていません。';
			loading = false;
			return;
		}

		// Call our new server-side API endpoint to perform the deletion
		const response = await fetch('/api/delete-user', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userToken: session.access_token })
		});

		const result = await response.json();

		if (!response.ok) {
			message = `エラー: ${result.error || 'アカウントの削除に失敗しました。'}`;
			loading = false;
		} else {
			alert('アカウントが正常に削除されました。');
			// Force a sign-out and redirect to the home page
			await supabase.auth.signOut();
			goto('/');
		}
	}
</script>

<div class="container">
	<div class="instruction">本当にアカウントを削除しますか？</div>
	<p class="warning-text">
		この操作は取り消せません。作成した検定や採点データを含む、すべてのアカウント情報が完全に削除されます。
	</p>

	{#if message}
		<p class="message">{message}</p>
	{/if}

	<div class="nav-buttons">
		<NavButton variant="danger" on:click={handleDeleteAccount} disabled={loading}>
			{loading ? '削除中...' : 'はい、削除します'}
		</NavButton>
		<NavButton on:click={() => goto('/account')}>いいえ、キャンセルします</NavButton>
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
