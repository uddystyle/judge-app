<script lang="ts">
	import { getContext } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { goto } from '$app/navigation';
	import NavButton from '$lib/components/NavButton.svelte';
	import { onMount } from 'svelte';

	const supabase = getContext<SupabaseClient>('supabase');

	let email = '';
	let password = '';
	let errorMessage = '';
	let loading = false;

	async function handleLogin() {
		loading = true;
		errorMessage = '';
		try {
			const { error } = await supabase.auth.signInWithPassword({
				email: email,
				password: password
			});

			if (error) {
				throw new Error('メールアドレスまたはパスワードが正しくありません。');
			}
			await goto('/dashboard');
		} catch (error: any) {
			errorMessage = error.message;
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		const {
			data: { user }
		} = await supabase.auth.getUser();

		if (user) {
			goto('/dashboard', { replaceState: true });
		}
	});
</script>

<div class="container">
	<div class="instruction">ログイン</div>

	<div class="form-container">
		<input
			type="email"
			bind:value={email}
			placeholder="メールアドレス"
			class="input-field"
			disabled={loading}
		/>
		<input
			type="password"
			bind:value={password}
			placeholder="パスワード"
			class="input-field"
			disabled={loading}
		/>

		{#if errorMessage}
			<p class="error-message">{errorMessage}</p>
		{/if}

		<div class="nav-buttons">
			<NavButton variant="primary" on:click={handleLogin} disabled={loading}>
				{loading ? 'ログイン中...' : 'ログイン'}
			</NavButton>
			<NavButton on:click={() => goto('/signup')}>新規登録</NavButton>
		</div>
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
		color: var(--primary-text);
		margin-bottom: 28px;
	}
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.input-field {
		padding: 15px;
		font-size: 17px;
		border: 1px solid var(--separator-gray);
		border-radius: 12px;
		background: white;
		color: var(--primary-text);
	}
	.input-field:focus {
		outline: none;
		border-color: var(--ios-blue);
	}
	.error-message {
		color: var(--ios-red);
		font-size: 14px;
		margin: 0;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 14px;
	}
</style>
