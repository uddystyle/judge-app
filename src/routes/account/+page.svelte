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

	// 「名前を更新」ボタンが押されたときの処理
	async function handleUpdateName() {
		if (!data.session) {
			message = 'エラー: ユーザー情報が見つかりません。';
			return;
		}
		loading = true;
		message = '';

		// profilesテーブルのfull_nameを更新
		const { error } = await supabase
			.from('profiles')
			.update({ full_name: fullName })
			.eq('id', data.session.user.id); // +layout.server.tsから渡されたセッション情報を使う

		if (error) {
			message = 'エラー: 名前の更新に失敗しました。' + error.message;
		} else {
			message = '名前を更新しました。';
			await invalidateAll();
		}
		loading = false;
	}
</script>

<Header />

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

	<div class="nav-buttons">
		<NavButton on:click={() => goto('/dashboard')}>検定選択に戻る</NavButton>
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
	}
</style>
