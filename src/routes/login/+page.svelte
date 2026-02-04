<script lang="ts">
	import { getContext } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import { onMount } from 'svelte';

	const supabase = getContext<SupabaseClient>('supabase');

	let email = '';
	let password = '';
	let errorMessage = '';
	let loading = false;
	let checkingAuth = true;

	// URLパラメータからエラーメッセージを取得（認証チェック後のみ）
	$: if (!checkingAuth && $page.url.searchParams.get('error')) {
		errorMessage = $page.url.searchParams.get('error') || '';
	}

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
		console.log('[login/onMount] 認証状態をチェック中...');
		const {
			data: { user }
		} = await supabase.auth.getUser();

		if (user) {
			console.log('[login/onMount] 既に認証済み。ダッシュボードへリダイレクト');
			goto('/dashboard', { replaceState: true });
		} else {
			console.log('[login/onMount] 未認証。ログインページを表示');
			checkingAuth = false;
		}
	});
</script>

<Header showAppName={true} pageUser={null} />

{#if checkingAuth}
	<div class="container">
		<LoadingSpinner />
	</div>
{:else}
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
				{#if loading}
					<span style="display: inline-flex; align-items: center; gap: 8px;">
						ログイン中
						<LoadingSpinner size="small" inline={true} />
					</span>
				{:else}
					ログイン
				{/if}
			</NavButton>
			<NavButton on:click={() => goto('/signup')}>新規登録</NavButton>
		</div>
	</div>

	<div class="nav-buttons" style="margin-top: 16px;">
		<NavButton on:click={() => goto('/')}>トップページに戻る</NavButton>
	</div>
</div>
{/if}

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
		background: var(--bg-primary);
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
		background: var(--bg-primary);
		color: var(--text-primary);
		transition: all 0.2s;
	}
	.input-field:focus {
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
