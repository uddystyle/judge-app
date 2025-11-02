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
	<div class="header-bar">
		<div class="instruction">参加するセッションを選択</div>
		<button class="account-button" on:click={() => goto('/account')}>
			{data.profile?.full_name || 'アカウント'}
		</button>
	</div>

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
						{#if session.mode === 'tournament'}
							<span class="mode-badge tournament">大会</span>
						{:else if session.mode === 'training'}
							<span class="mode-badge training">研修</span>
						{:else}
							<span class="mode-badge">検定</span>
						{/if}
					</div>
					<div class="join-code-wrapper">
						<div class="join-code-display">
							<span class="join-code-label">コード:</span>
							<span class="join-code-value">{session.join_code}</span>
						</div>
						<button
							class="copy-btn"
							on:click={(e) => copyJoinCode(e, session.join_code, session.id)}
						>
							{#if copiedSessionId === session.id}
								✓ コピー済
							{:else}
								COPY
							{/if}
						</button>
						<a href={`/session/${session.id}/details`} class="details-btn" on:click|stopPropagation
							>詳細</a
						>
					</div>
				</div>
			{/each}
		{:else}
			<p style="color: var(--secondary-text);">参加中の検定・大会・研修はありません。</p>
		{/if}
	</div>

	<div class="nav-buttons">
		<NavButton variant="primary" on:click={() => goto('/session/create')}>
			新しい検定・大会・研修を作成
		</NavButton>
		<NavButton on:click={() => goto('/session/join')}>コードで参加</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 1200px;
		margin: 0 auto;
	}
	.header-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 28px;
		gap: 16px;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		color: var(--text-primary);
		line-height: 1.3;
		flex: 1;
		text-align: left;
	}
	.account-button {
		background: var(--bg-white);
		color: var(--text-primary);
		border: 2px solid var(--border-light);
		border-radius: 20px;
		padding: 8px 16px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}
	.account-button:hover {
		border-color: var(--primary-orange);
		background: var(--primary-orange-hover);
		box-shadow: 0 4px 12px rgba(255, 107, 53, 0.15);
	}
	.account-button:active {
		transform: scale(0.98);
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
		background: var(--bg-white);
		color: var(--ios-blue);
		border-radius: 12px;
		width: 100%;
		font-size: 17px;
		font-weight: 600;
		text-align: center;
		border: 2px solid var(--border-light);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
		cursor: pointer;
		transition: all 0.2s;
	}
	.key.select-item:hover {
		border-color: var(--primary-orange);
		box-shadow: 0 4px 16px rgba(255, 107, 53, 0.15);
		transform: translateY(-2px);
	}
	.key.select-item:active {
		background-color: var(--primary-orange-hover);
		transform: translateY(0);
	}
	.session-name {
		font-size: 18px;
		font-weight: 600;
		text-align: center;
		color: var(--text-primary);
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: center;
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
	.mode-badge.training {
		background: var(--primary-orange);
	}
	.join-code-wrapper {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: center;
	}
	.join-code-display {
		display: flex;
		align-items: center;
		gap: 4px;
		background-color: var(--bg-beige);
		padding: 6px 12px;
		border-radius: 8px;
		border: 1px solid var(--border-light);
	}
	.join-code-label {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.join-code-value {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
		font-family: 'Courier New', monospace;
		letter-spacing: 1px;
	}
	.copy-btn {
		font-size: 12px;
		font-weight: 600;
		color: white;
		background-color: var(--ios-blue);
		padding: 6px 12px;
		border-radius: 8px;
		border: none;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}
	.copy-btn:hover {
		background-color: #0051d5;
		box-shadow: 0 2px 8px rgba(0, 122, 255, 0.3);
	}
	.copy-btn:active {
		background-color: #004bb5;
		transform: scale(0.95);
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.details-btn {
		background-color: var(--primary-orange);
		color: white;
		border: none;
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		transition: all 0.2s;
	}
	.details-btn:hover {
		background-color: var(--primary-orange-light);
	}
	.details-btn:active {
		background-color: var(--primary-orange);
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
		}
		.header-bar {
			margin-bottom: 40px;
		}
		.instruction {
			font-size: 36px;
		}
		.account-button {
			font-size: 16px;
			padding: 10px 20px;
			border-radius: 24px;
		}
		.list-keypad {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			gap: 20px;
		}
		.key.select-item {
			min-height: 120px;
			padding: 24px;
		}
		.session-name {
			font-size: 20px;
		}
		.nav-buttons {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			gap: 16px;
			margin-top: 40px;
		}
	}

	/* PC対応: デスクトップ */
	@media (min-width: 1024px) {
		.instruction {
			font-size: 42px;
		}
		.account-button {
			font-size: 18px;
			padding: 12px 24px;
		}
		.list-keypad {
			grid-template-columns: repeat(3, 1fr);
			gap: 24px;
		}
		.key.select-item {
			min-height: 140px;
		}
		.nav-buttons {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
