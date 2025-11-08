<script lang="ts">
	import { getContext } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { goto } from '$app/navigation';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
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

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<Header showAppName={true} pageUser={null} />

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

	<div class="nav-buttons" style="margin-top: 16px;">
		<NavButton on:click={() => goto('/')}>トップページに戻る</NavButton>
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
		background: var(--bg-white);
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
		background: var(--bg-white);
		color: var(--text-primary);
		transition: all 0.2s;
	}
	.input-field:focus {
		outline: none;
		border-color: var(--primary-orange);
		box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.1);
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
		.error-message {
			font-size: 15px;
			padding: 14px;
		}
	}
</style>
