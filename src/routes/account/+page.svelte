<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { invalidateAll } from '$app/navigation';

	// サーバーから渡されたデータを受け取る
	export let data: PageData;
	// レイアウトから共有されたSupabaseクライアントを受け取る
	const supabase = getContext<SupabaseClient>('supabase');

	// フォームの入力値を保持する変数 (初期値としてサーバーから取得した氏名を設定)
	let fullName = data.profile?.full_name || '';
	let loading = false;
	let message = '';

	let newPassword = '';
	let confirmPassword = '';
	let passwordLoading = false;
	let passwordMessage = '';

	// 「名前を更新」ボタンが押されたときの処理
	async function handleUpdateName() {
		if (!data.user) {
			message = 'エラー: ユーザー情報が見つかりません。';
			return;
		}
		loading = true;
		message = '';

		// profilesテーブルのfull_nameを更新
		const { error } = await supabase
			.from('profiles')
			.update({ full_name: fullName })
			.eq('id', data.user.id); // +layout.server.tsから渡されたユーザー情報を使う

		if (error) {
			message = 'エラー: 名前の更新に失敗しました。' + error.message;
		} else {
			message = '名前を更新しました。';
			await invalidateAll();
		}
		loading = false;
	}

	async function handleUpdatePassword() {
		// Basic validation
		if (newPassword.length < 6) {
			passwordMessage = 'エラー: パスワードは6文字以上で入力してください。';
			return;
		}
		if (newPassword !== confirmPassword) {
			passwordMessage = 'エラー: パスワードが一致しません。';
			return;
		}

		passwordLoading = true;
		passwordMessage = '';

		// Update the user's password in Supabase Auth
		const { error } = await supabase.auth.updateUser({
			password: newPassword
		});

		if (error) {
			passwordMessage = 'エラー: パスワードの更新に失敗しました。' + error.message;
		} else {
			passwordMessage = 'パスワードを更新しました。';
			// Clear input fields on success
			newPassword = '';
			confirmPassword = '';
		}
		passwordLoading = false;
	}

	async function handleLogout() {
		// Supabaseからログアウトを実行
		await supabase.auth.signOut();

		// ログアウト後、ログインページへ移動
		goto('/login');
	}
</script>

<div class="container">
	<div class="instruction">アカウント設定</div>

	<div class="form-container">
		<label for="account-name" class="form-label">氏名</label>
		<input type="text" id="account-name" placeholder="氏名" bind:value={fullName} />

		<div class="nav-buttons" style="margin-top: 0;">
			<NavButton variant="primary" on:click={handleUpdateName} disabled={loading}>
				{loading ? '更新中...' : '名前を更新'}
			</NavButton>
		</div>

		{#if message}
			<p class="message">{message}</p>
		{/if}
	</div>

	<hr class="divider" />

	<div class="form-container">
		<label for="account-password" class="form-label">新しいパスワード</label>
		<input
			type="password"
			id="account-password"
			placeholder="新しいパスワード (6文字以上)"
			bind:value={newPassword}
		/>
		<input
			type="password"
			id="account-password-confirm"
			placeholder="新しいパスワード (確認)"
			bind:value={confirmPassword}
		/>
		<div class="nav-buttons" style="margin-top: 0;">
			<NavButton variant="primary" on:click={handleUpdatePassword} disabled={passwordLoading}>
				{passwordLoading ? '更新中...' : 'パスワードを更新'}
			</NavButton>
		</div>
		{#if passwordMessage}
			<p class="message">{passwordMessage}</p>
		{/if}
	</div>

	<div class="nav-buttons">
		<hr class="divider" />

		<NavButton on:click={() => goto('/dashboard')}>セッション選択画面に戻る</NavButton>
		<NavButton variant="danger" on:click={handleLogout}>ログアウト</NavButton>
		<NavButton variant="danger" on:click={() => goto('/account/delete')}>
			アカウントを削除
		</NavButton>
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
		text-align: left;
	}
	.form-label {
		font-size: 15px;
		font-weight: 500;
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
	.message {
		text-align: center;
		margin-top: 1rem;
		color: var(--ios-red);
	}
	.divider {
		border: none;
		border: 1px solid var(--separator-gray);
		margin: 24px 0;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 600px;
		}
		.instruction {
			font-size: 36px;
			margin-bottom: 40px;
		}
		.form-label {
			font-size: 18px;
		}
		.form-container input {
			padding: 18px;
			font-size: 18px;
		}
		.message {
			font-size: 16px;
		}
		.nav-buttons {
			margin-top: 40px;
		}
	}
</style>
