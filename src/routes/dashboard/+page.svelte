<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import { goto } from '$app/navigation';
	import { getContext, onMount, onDestroy } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';

	const supabase = getContext<SupabaseClient>('supabase');

	// `+page.server.ts`のload関数から返されたデータを受け取る
	export let data: PageData;

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

	// 大会モードで検定員数が揃っているかチェック
	function canStartTournament(participantCount: number): boolean {
		return participantCount === 3 || participantCount === 5;
	}

	// アラートダイアログの状態
	let showAlert = false;
	let alertMessage = '';
	let alertTitle = '開始できません';

	// セッションクリック時の処理
	function handleSessionClick(session: any) {
		// 大会モードで検定員数が揃っていない場合
		if (session.mode === 'tournament' && !canStartTournament(session.participantCount)) {
			alertMessage = `大会モードを開始するには、\n3人または5人の検定員が必要です。\n\n現在の検定員数: ${session.participantCount}人`;
			showAlert = true;
			return;
		}
		goto(`/session/${session.id}`);
	}
</script>

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} hasOrganization={data.organizations && data.organizations.length > 0} pageOrganizations={data.organizations || []} />

<div class="container">

	<div class="section">
		<h2 class="section-title">参加中のセッション</h2>
		<div class="list-keypad">
			{#if data.sessions && data.sessions.length > 0}
				{#each data.sessions as session}
					{@const isTournament = session.mode === 'tournament'}
					{@const canStart = !isTournament || canStartTournament(session.participantCount)}
					<div
						class="key select-item"
						class:disabled={!canStart}
					>
						<div class="session-info-wrapper">
							<div class="badges-container">
								{#if session.mode === 'tournament'}
									<span class="mode-badge tournament">大会</span>
									{#if canStart}
										<span class="scoring-method-badge">
											{session.exclude_extremes ? '5審3採' : '3審3採'}
										</span>
									{/if}
								{:else if session.mode === 'training'}
									<span class="mode-badge training">研修</span>
									<span class="judge-mode-badge" class:individual={!session.isMultiJudge}>
										{session.isMultiJudge ? '合同採点' : '個別採点'}
									</span>
								{:else}
									<span class="mode-badge">検定</span>
									<span class="judge-mode-badge" class:individual={!session.isMultiJudge}>
										{session.isMultiJudge ? '合同採点' : '個別採点'}
									</span>
								{/if}
							</div>
							<div class="session-name">
								{session.name}
							</div>
							{#if isTournament && !canStart}
								<div class="participant-count">
									<span class="participant-label">検定員:</span>
									<span class="participant-value warning">
										{session.participantCount}人
									</span>
									<span class="warning-text">(3人または5人必要)</span>
								</div>
							{/if}
							<div class="session-buttons">
								<a
									href="/session/{session.id}/details"
									class="details-btn"
								>
									詳細
								</a>
								<button
									class="start-btn"
									class:disabled={!canStart}
									on:click={() => handleSessionClick(session)}
								>
									セッションを開始
								</button>
							</div>
						</div>
					</div>
				{/each}
			{:else}
				<p style="color: var(--secondary-text);">参加中の検定・大会・研修はありません。</p>
			{/if}
		</div>
	</div>

	<hr class="divider" />

	<div class="nav-buttons">
		{#if data.organizations && data.organizations.length > 0}
			<NavButton variant="primary" on:click={() => goto('/session/create')}>
				新しいセッションを作成
			</NavButton>
		{/if}
		<NavButton on:click={() => goto('/session/join')}>コードでセッションに参加</NavButton>
	</div>
</div>

<AlertDialog
	bind:isOpen={showAlert}
	title={alertTitle}
	message={alertMessage}
	confirmText="OK"
	on:confirm={() => {}}
/>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 1200px;
		margin: 0 auto;
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
	.session-buttons {
		display: flex;
		gap: 10px;
		margin-top: 12px;
		justify-content: center;
		flex-wrap: wrap;
	}
	.details-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		color: var(--accent-primary);
		border: 1.5px solid var(--accent-primary);
		border-radius: 8px;
		padding: 8px 20px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
		text-decoration: none;
		min-height: 40px;
		letter-spacing: 0.02em;
	}
	.details-btn:hover {
		background: var(--accent-primary);
		color: white;
		transform: translateY(-1px);
	}
	.details-btn:active {
		transform: translateY(0);
	}
	.start-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--accent-primary);
		color: white;
		border: 1.5px solid var(--accent-primary);
		border-radius: 8px;
		padding: 8px 20px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
		min-height: 40px;
		letter-spacing: 0.02em;
	}
	.start-btn:hover {
		background: var(--accent-hover);
		border-color: var(--accent-hover);
		transform: translateY(-1px);
	}
	.start-btn:active {
		transform: translateY(0);
	}
	.start-btn.disabled {
		background: #ccc;
		border-color: #ccc;
		cursor: not-allowed;
	}
	.start-btn.disabled:hover {
		transform: none;
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
		background: var(--bg-primary);
		color: var(--text-primary);
		border-radius: 12px;
		width: 100%;
		max-width: 100%;
		font-size: 17px;
		font-weight: 600;
		text-align: center;
		border: 1px solid var(--border-light);
	}
	.key.select-item.disabled .session-info-wrapper {
		opacity: 0.6;
	}
	.session-info-wrapper {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 100%;
	}
	.session-name {
		font-size: 18px;
		font-weight: 600;
		text-align: center;
		color: var(--text-primary);
	}
	.badges-container {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: center;
	}
	.participant-count {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-size: 14px;
		flex-wrap: wrap;
	}
	.participant-label {
		font-weight: 500;
		color: var(--text-secondary);
	}
	.participant-value {
		font-weight: 600;
		color: var(--text-primary);
	}
	.participant-value.warning {
		color: #dc3545;
	}
	.warning-text {
		font-size: 12px;
		color: #dc3545;
		font-weight: 500;
	}
	.mode-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		font-weight: 500;
		color: #6b7280;
		background: transparent;
		padding: 4px 12px;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		letter-spacing: 0.01em;
	}
	.mode-badge.tournament {
		color: #6b7280;
		border-color: #d1d5db;
	}
	.mode-badge.training {
		color: #6b7280;
		border-color: #d1d5db;
	}
	.scoring-method-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		font-weight: 500;
		color: #6b7280;
		background: transparent;
		padding: 4px 12px;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		letter-spacing: 0.01em;
	}
	.judge-mode-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		font-weight: 500;
		color: #6b7280;
		background: transparent;
		padding: 4px 12px;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		letter-spacing: 0.01em;
	}
	.judge-mode-badge.individual {
		color: #6b7280;
		border-color: #d1d5db;
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

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
		}
		.list-keypad {
			gap: 20px;
		}
		.session-buttons {
			gap: 12px;
			margin-top: 16px;
		}
		.details-btn,
		.start-btn {
			font-size: 14px;
			padding: 10px 24px;
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
		.section-title {
			font-size: 20px;
		}
		.divider {
			margin: 56px auto;
		}
	}

	/* PC対応: デスクトップ */
	@media (min-width: 1024px) {
		.list-keypad {
			gap: 24px;
			max-width: 600px;
		}
		.session-buttons {
			gap: 14px;
			margin-top: 20px;
		}
		.details-btn,
		.start-btn {
			font-size: 15px;
			padding: 10px 28px;
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
