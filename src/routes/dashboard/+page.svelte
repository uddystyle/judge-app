<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';

	const supabase = getContext<SupabaseClient>('supabase');

	async function handleLogout() {
		// Supabaseからログアウトを実行
		await supabase.auth.signOut();

		// ログアウト後、ログインページへ移動
		goto('/login');
	}
	// `+page.server.ts`のload関数から返されたデータを受け取る
	export let data: PageData;

	// どのセッションコードがコピーされたかを追跡
	let copiedSessionId: string | null = null;

	function copyJoinCode(event: MouseEvent, code: string, sessionId: string) {
		// イベントが親要素に伝播してページ遷移が起きるのを防ぐ
		event.stopPropagation();

		navigator.clipboard.writeText(code).then(
			() => {
				copiedSessionId = sessionId;
				// 1.5秒後にもとに戻す
				setTimeout(() => {
					copiedSessionId = null;
				}, 1500);
			},
			(err) => {
				console.error('コピーに失敗しました:', err);
				alert('コピーに失敗しました。');
			}
		);
	}
</script>

<div class="container">
	<div class="instruction">検定・大会を選択</div>

	<div class="list-keypad">
		{#if data.sessions && data.sessions.length > 0}
			{#each data.sessions as session}
				<div
					class="key select-item"
					on:click={() => goto(`/session/${session.id}`)}
					role="button"
					tabindex="0"
					on:keydown={(e) => e.key === 'Enter' && goto(`/session/${session.id}`)}
				>
					<div class="session-name">
						{session.name}
						{#if session.is_tournament_mode}
							<span class="mode-badge tournament">大会</span>
						{:else}
							<span class="mode-badge">検定</span>
						{/if}
					</div>
					<div class="join-code-wrapper">
						<button
							class="join-code"
							on:click={(e) => copyJoinCode(e, session.join_code, session.id)}
						>
							{#if copiedSessionId === session.id}
								コピーしました
							{:else}
								コード: {session.join_code}
							{/if}
						</button>
						<a href={`/session/${session.id}/details`} class="details-btn" on:click|stopPropagation
							>詳細</a
						>
					</div>
				</div>
			{/each}
		{:else}
			<p style="color: var(--secondary-text);">参加中の検定・大会はありません。</p>
		{/if}
	</div>

	<div class="nav-buttons">
		<NavButton variant="primary" on:click={() => goto('/session/create')}>
			新しい検定・大会を作成
		</NavButton>
		<NavButton on:click={() => goto('/session/join')}>コードで参加</NavButton>
		<NavButton on:click={() => goto('/account')}>アカウント設定</NavButton>
		<NavButton variant="danger" on:click={handleLogout}>ログアウト</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 28px;
		line-height: 1.3;
	}
	.list-keypad {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 100%;
	}
	.key.select-item {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 16px;
		gap: 8px;
		height: auto;
		min-height: 70px;
		background: white;
		color: var(--ios-blue);
		border-radius: 12px;
		width: 100%;
		font-size: 17px;
		font-weight: 600;
		text-align: center;
		border: 1px solid rgba(0, 0, 0, 0.04);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
		cursor: pointer;
		transition: background-color 0.2s;
	}
	.key.select-item:active {
		background-color: var(--light-gray);
	}
	.session-name {
		font-size: 18px;
		font-weight: 600;
		text-align: center;
		color: var(--primary-text);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.mode-badge {
		font-size: 11px;
		font-weight: 600;
		color: white;
		background: var(--ios-blue);
		padding: 2px 6px;
		border-radius: 4px;
	}
	.mode-badge.tournament {
		background: var(--ios-green);
	}
	.join-code-wrapper {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.join-code {
		font-size: 14px;
		font-weight: 400;
		color: var(--secondary-text);
		background-color: #e8e8ed;
		padding: 4px 8px;
		border-radius: 6px;
		border: none;
		cursor: pointer;
		transition: background-color 0.2s;
	}
	.join-code:active {
		background-color: #d1d1d6;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.details-btn {
		background-color: var(--ios-blue);
		color: white;
		border: none;
		border-radius: 8px;
		padding: 6px 10px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		margin-left: 4px;
	}
	.details-btn:active {
		background-color: #0062cc;
	}
</style>
