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
	let successMessage = '';
	let loading = false;
	let checkingAuth = true;

	// URLパラメータからエラーメッセージを取得（認証チェック後のみ）
	$: if (!checkingAuth && $page.url.searchParams.get('error')) {
		errorMessage = $page.url.searchParams.get('error') || '';
	}

	// URLパラメータから成功メッセージを取得
	$: if (!checkingAuth && $page.url.searchParams.get('success') === 'password-reset') {
		successMessage = 'パスワードが正常に更新されました。新しいパスワードでログインしてください。';
	}

	/**
	 * メールアドレスを正規化（小文字化 + トリム）
	 * サインアップと同じ正規化を適用し、一貫性を保つ
	 */
	function normalizeEmail(email: string): string {
		return email.trim().toLowerCase();
	}

	async function handleLogin() {
		loading = true;
		errorMessage = '';
		try {
			// メールアドレスを正規化してログイン
			const normalizedEmail = normalizeEmail(email);

			console.log('[login] ログイン試行:', {
				originalEmail: email,
				normalizedEmail
			});

			const { error } = await supabase.auth.signInWithPassword({
				email: normalizedEmail,
				password: password
			});

			if (error) {
				console.error('[login] signIn error:', {
					code: error.code,
					message: error.message,
					status: (error as any).status
				});

				// エラーコードベースの判定（文字列マッチングではなくコード判定）
				// Supabase Auth Error Codes: https://supabase.com/docs/guides/auth/debugging/error-codes

				// 無効な認証情報
				if (error.code === 'invalid_credentials') {
					throw new Error('メールアドレスまたはパスワードが正しくありません。');
				}

				// メール未確認
				if (error.code === 'email_not_confirmed') {
					throw new Error('メールアドレスが確認されていません。確認メールをご確認ください。');
				}

				// レート制限
				if (error.code === 'too_many_requests' || (error as any).status === 429) {
					throw new Error('ログイン試行回数が上限に達しました。しばらく待ってから再度お試しください。');
				}

				// その他の予期しないエラー
				console.error('[login] Unexpected error code:', error.code);
				throw new Error('ログインに失敗しました。再度お試しください。');
			}

			console.log('[login] ログイン成功');
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

		{#if successMessage}
			<p class="success-message">{successMessage}</p>
		{/if}

		{#if errorMessage}
			<p class="error-message">{errorMessage}</p>
		{/if}

		<div class="forgot-password-link">
			<a href="/reset-password">パスワードを忘れた場合</a>
		</div>

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
	.success-message {
		color: #10b981;
		font-size: 14px;
		margin: 0;
		padding: 12px;
		background: #f0fdf4;
		border-radius: 8px;
		border: 1px solid #bbf7d0;
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
	.forgot-password-link {
		text-align: right;
		margin-top: -8px;
	}
	.forgot-password-link a {
		color: var(--accent-primary);
		font-size: 14px;
		text-decoration: none;
		transition: color 0.2s;
	}
	.forgot-password-link a:hover {
		color: var(--accent-hover);
		text-decoration: underline;
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
		.success-message {
			font-size: 15px;
			padding: 14px;
		}
		.error-message {
			font-size: 15px;
			padding: 14px;
		}
		.forgot-password-link a {
			font-size: 15px;
		}
	}
</style>
