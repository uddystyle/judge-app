<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { goto } from '$app/navigation';
	import { getContext, onMount, onDestroy } from 'svelte';
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

	// リアルタイム更新用
	let realtimeChannel: any;

	onMount(() => {
		// セッションの削除を検知するリアルタイムリスナー
		realtimeChannel = supabase
			.channel('dashboard-sessions')
			.on(
				'postgres_changes',
				{
					event: 'DELETE',
					schema: 'public',
					table: 'sessions'
				},
				(payload) => {
					console.log('[ダッシュボード] セッション削除を検知:', payload);
					// 削除されたセッションをリストから除外
					data.sessions = data.sessions.filter((s) => s.id !== payload.old.id);
				}
			)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'session_participants',
					filter: `user_id=eq.${data.profile?.id}`
				},
				async (payload) => {
					console.log('[ダッシュボード] セッション参加を検知:', payload);
					// 新しく参加したセッションの情報を取得
					const { data: newSession } = await supabase
						.from('sessions')
						.select('*')
						.eq('id', payload.new.session_id)
						.single();

					if (newSession) {
						// リストに追加（重複チェック）
						const exists = data.sessions.some((s) => s.id === newSession.id);
						if (!exists) {
							data.sessions = [...data.sessions, newSession];
						}
					}
				}
			)
			.subscribe((status) => {
				console.log('[ダッシュボード] Realtimeチャンネルの状態:', status);
			});
	});

	onDestroy(() => {
		if (realtimeChannel) {
			supabase.removeChannel(realtimeChannel);
		}
	});

	// プラン名の表示
	function getPlanName(planType: string): string {
		switch (planType) {
			case 'free':
				return 'フリー';
			case 'basic':
				return 'Basic';
			case 'standard':
				return 'Standard';
			case 'premium':
				return 'Premium';
			default:
				return 'フリー';
		}
	}
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="container">
	<div class="header-bar">
		<div class="title-section">
			<h1 class="app-title">TENTO</h1>
			<p class="app-subtitle">スキー・スノーボード検定・大会のための採点管理システム</p>
		</div>
		<button class="account-button" on:click={() => goto('/account')}>
			{data.profile?.full_name || 'アカウント'}
		</button>
	</div>

	<div class="section">
		<h2 class="section-title">参加中のセッション</h2>
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
	</div>

	<hr class="divider" />

	<div class="section">
		<h2 class="section-title">所属組織</h2>
		<div class="list-keypad">
			{#if data.organizations && data.organizations.length > 0}
				{#each data.organizations as org}
					<div
						class="key select-item organization-item"
						on:click={() => goto(`/organization/${org.id}`)}
						role="button"
						tabindex="0"
						on:keydown={(e) => e.key === 'Enter' && goto(`/organization/${org.id}`)}
					>
						<div class="session-name">
							{org.name}
							{#if org.userRole === 'admin'}
								<span class="mode-badge admin">管理者</span>
							{:else}
								<span class="mode-badge member">メンバー</span>
							{/if}
						</div>
						<div class="organization-info">
							<span class="plan-badge">{getPlanName(org.plan_type)}</span>
							<span class="member-count"
								>メンバー: {org.max_members === -1 ? '無制限' : `${org.max_members}名まで`}</span
							>
						</div>
					</div>
				{/each}
			{:else}
				<p style="color: var(--secondary-text);">所属組織はありません。</p>
			{/if}
		</div>
		<div class="nav-buttons" style="margin-top: 20px;">
			<NavButton on:click={() => goto('/onboarding/create-organization')}>組織を作成</NavButton>
		</div>
	</div>

	<hr class="divider" />

	<div class="nav-buttons">
		{#if data.organizations && data.organizations.length > 0}
			<NavButton variant="primary" on:click={() => goto('/session/create')}>
				新しいセッションを作成
			</NavButton>
		{/if}
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
	.title-section {
		flex: 1;
		text-align: left;
	}
	.app-title {
		font-family: 'M PLUS Rounded 1c', sans-serif;
		font-size: 28px;
		font-weight: 800;
		color: #2d2d2d;
		line-height: 1.2;
		margin: 0 0 8px 0;
		letter-spacing: 0.05em;
	}
	.app-subtitle {
		font-size: 13px;
		font-weight: 500;
		color: #5d5d5d;
		margin: 0;
		line-height: 1.4;
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
		max-width: 600px;
		margin-left: auto;
		margin-right: auto;
		width: 100%;
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
		max-width: 100%;
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
		min-width: 85px;
		text-align: center;
	}
	.copy-btn:hover {
		background-color: #0051d5;
		box-shadow: 0 2px 8px rgba(0, 122, 255, 0.3);
	}
	.copy-btn:active {
		background-color: #004bb5;
		transform: scale(0.95);
	}

	/* セクション区切り */
	.section {
		margin-bottom: 32px;
		text-align: center;
	}
	.section-title {
		font-size: 18px;
		font-weight: 600;
		color: var(--primary-text);
		margin-bottom: 32px;
		text-align: center;
	}
	.divider {
		border: none;
		border-top: 1px solid var(--separator-gray);
		margin: 48px auto;
		max-width: 600px;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		max-width: 500px;
		margin-left: auto;
		margin-right: auto;
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
	.organization-item {
		background: linear-gradient(135deg, #ffffff 0%, #fffbf7 100%);
	}
	.organization-info {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		justify-content: center;
		font-size: 14px;
		color: var(--text-secondary);
	}
	.plan-badge {
		background: var(--primary-orange);
		color: white;
		padding: 4px 10px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 600;
	}
	.member-count {
		font-size: 13px;
		color: var(--text-secondary);
	}
	.mode-badge.admin {
		background: var(--primary-orange);
	}
	.mode-badge.member {
		background: var(--ios-blue);
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
		}
		.header-bar {
			margin-bottom: 40px;
		}
		.app-title {
			font-size: 36px;
		}
		.app-subtitle {
			font-size: 15px;
		}
		.account-button {
			font-size: 16px;
			padding: 10px 20px;
			border-radius: 24px;
		}
		.list-keypad {
			gap: 20px;
		}
		.key.select-item {
			min-height: 180px;
			padding: 32px;
			gap: 16px;
		}
		.session-name {
			font-size: 22px;
			margin-bottom: 8px;
		}
		.join-code-wrapper {
			flex-wrap: nowrap;
			gap: 16px;
			width: 100%;
		}
		.join-code-display {
			padding: 10px 20px;
			flex-shrink: 0;
		}
		.join-code-label {
			font-size: 13px;
		}
		.join-code-value {
			font-size: 15px;
		}
		.copy-btn {
			font-size: 13px;
			padding: 8px 16px;
			min-width: 100px;
			flex-shrink: 0;
		}
		.details-btn {
			font-size: 13px;
			padding: 8px 16px;
			white-space: nowrap;
		}
		.section-title {
			font-size: 20px;
		}
		.divider {
			margin: 56px auto;
		}
	}

	/* PC対応: デスクトップ */
	@media (min-width: 1024px) {
		.app-title {
			font-size: 42px;
		}
		.app-subtitle {
			font-size: 16px;
		}
		.account-button {
			font-size: 18px;
			padding: 12px 24px;
		}
		.list-keypad {
			gap: 24px;
			max-width: 600px;
		}
		.key.select-item {
			min-height: 140px;
		}
		.section-title {
			font-size: 24px;
		}
		.divider {
			margin: 64px auto;
			max-width: 600px;
		}
	}
</style>

<Footer />
