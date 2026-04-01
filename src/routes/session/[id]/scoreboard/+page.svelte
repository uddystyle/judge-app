<script lang="ts">
	import type { PageData } from './$types';
	import Header from '$lib/components/Header.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { createRealtimeChannel, type RealtimeChannelHandle } from '$lib/realtime';

	export let data: PageData;

	let selectedTab: 'overall' | number = 'overall';
	let realtimeHandle: RealtimeChannelHandle | null = null;
	let shareUrl = '';
	let showCopiedMessage = false;

	// ページをリロードして最新データを取得
	async function refreshData() {
		window.location.reload();
	}

	// リンクをコピー
	function copyShareLink() {
		const url = `${window.location.origin}/scoreboard/${sessionId}`;
		navigator.clipboard.writeText(url).then(() => {
			showCopiedMessage = true;
			setTimeout(() => {
				showCopiedMessage = false;
			}, 2000);
		});
	}

	// Realtimeで自動更新（resultsテーブル監視）
	onMount(() => {
		const sessionId = $page.params.id;
		shareUrl = `${window.location.origin}/scoreboard/${sessionId}`;

		realtimeHandle = createRealtimeChannel(supabase, {
			channelName: `scoreboard-${sessionId}`,
			table: 'results',
			filter: `session_id=eq.${sessionId}`,
			onPayload: (payload) => {
				console.log('[scoreboard] スコア変更を検知 - リロード中...', payload.eventType);
				refreshData();
			}
		});
	});

	onDestroy(() => {
		realtimeHandle?.cleanup();
	});

	$: sessionId = $page.params.id;
</script>

<Header
	showAppName={true}
	pageUser={data.user}
	pageProfile={data.profile}
	isGuest={false}
	guestName={null}
/>

<div class="container">
	<div class="header-section">
		<h1 class="title">{data.sessionDetails.name}</h1>
		<p class="subtitle">スコアボード</p>
	</div>

	<!-- タブ -->
	<div class="tabs">
		<button class="tab" class:active={selectedTab === 'overall'} on:click={() => (selectedTab = 'overall')}>
			総合
		</button>
		{#each data.events as event}
			<button
				class="tab"
				class:active={selectedTab === event.id}
				on:click={() => (selectedTab = event.id)}
			>
				{event.event_name}
			</button>
		{/each}
	</div>

	<!-- 総合ランキング -->
	{#if selectedTab === 'overall'}
		<div class="ranking-container">
			<div class="ranking-header">
				<div class="rank-col">順位</div>
				<div class="bib-col">ゼッケン</div>
				<div class="score-col">総合得点</div>
			</div>
			{#if data.overallRanking.length > 0}
				{#each data.overallRanking as entry}
					<div class="ranking-row" class:top3={entry.rank <= 3}>
						<div class="rank-col">
							{#if entry.rank === 1}
								🥇
							{:else if entry.rank === 2}
								🥈
							{:else if entry.rank === 3}
								🥉
							{:else}
								{entry.rank}位
							{/if}
						</div>
						<div class="bib-col">{entry.bib}番</div>
						<div class="score-col">{entry.total_score}点</div>
					</div>
				{/each}
			{:else}
				<div class="no-data">まだ採点結果がありません</div>
			{/if}
		</div>
	{/if}

	<!-- 種目別ランキング -->
	{#each data.eventRankings as eventRanking}
		{#if selectedTab === eventRanking.event_id}
			<div class="ranking-container">
				<div class="event-title">
					{eventRanking.discipline} - {eventRanking.level} - {eventRanking.event_name}
				</div>
				<div class="ranking-header">
					<div class="rank-col">順位</div>
					<div class="bib-col">ゼッケン</div>
					<div class="score-col">得点</div>
				</div>
				{#if eventRanking.ranking.length > 0}
					{#each eventRanking.ranking as entry}
						<div class="ranking-row" class:top3={entry.rank <= 3}>
							<div class="rank-col">
								{#if entry.rank === 1}
									🥇
								{:else if entry.rank === 2}
									🥈
								{:else if entry.rank === 3}
									🥉
								{:else}
									{entry.rank}位
								{/if}
							</div>
							<div class="bib-col">{entry.bib}番</div>
							<div class="score-col">{entry.score}点</div>
						</div>
					{/each}
				{:else}
					<div class="no-data">まだ採点結果がありません</div>
				{/if}
			</div>
		{/if}
	{/each}

	<!-- 共有セクション -->
	<div class="share-section">
		<h3 class="share-title">スコアボードを共有</h3>
		<p class="share-description">このリンクは誰でも閲覧できます（認証不要）</p>
		<div class="share-url-container">
			<input type="text" class="share-url-input" value={shareUrl} readonly />
		</div>
		<button class="share-btn" on:click={copyShareLink}>
			{showCopiedMessage ? '✓ コピーしました！' : '📋 リンクをコピー'}
		</button>
	</div>

	<div class="nav-buttons">
		<NavButton on:click={refreshData}>最新データを取得</NavButton>
		<NavButton on:click={() => goto(`/session/${sessionId}/details`)}>セッション詳細ページに戻る</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		max-width: 800px;
		margin: 0 auto;
	}
	.header-section {
		text-align: center;
		margin-bottom: 28px;
	}
	.title {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 8px;
		color: var(--primary-text);
	}
	.subtitle {
		font-size: 16px;
		color: var(--secondary-text);
	}

	.tabs {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		margin-bottom: 24px;
		padding-bottom: 8px;
		border-bottom: 2px solid var(--separator-gray);
	}
	.tab {
		background: white;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		padding: 10px 16px;
		font-size: 15px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		color: var(--primary-text);
	}
	.tab.active {
		background: var(--ios-blue);
		color: white;
		border-color: var(--ios-blue);
	}

	.ranking-container {
		background: white;
		border-radius: 12px;
		overflow: hidden;
		margin-bottom: 24px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}
	.event-title {
		background: #f8f9fa;
		padding: 12px 16px;
		font-size: 16px;
		font-weight: 600;
		color: var(--primary-text);
		border-bottom: 1px solid var(--separator-gray);
	}
	.ranking-header {
		display: grid;
		grid-template-columns: 80px 1fr 120px;
		background: #f8f9fa;
		padding: 12px 16px;
		font-size: 14px;
		font-weight: 600;
		color: var(--secondary-text);
		border-bottom: 1px solid var(--separator-gray);
	}
	.ranking-row {
		display: grid;
		grid-template-columns: 80px 1fr 120px;
		padding: 16px;
		border-bottom: 1px solid var(--separator-gray);
		transition: background-color 0.2s;
	}
	.ranking-row:last-child {
		border-bottom: none;
	}
	.ranking-row.top3 {
		background: #fffdf0;
	}
	.rank-col {
		font-size: 18px;
		font-weight: 600;
		color: var(--primary-text);
	}
	.bib-col {
		font-size: 18px;
		font-weight: 500;
		color: var(--primary-text);
	}
	.score-col {
		font-size: 20px;
		font-weight: 700;
		color: var(--ios-blue);
		text-align: right;
	}
	.no-data {
		padding: 40px 20px;
		text-align: center;
		color: var(--secondary-text);
		font-size: 15px;
	}

	.share-section {
		background: white;
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 24px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}
	.share-title {
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 8px;
		color: var(--primary-text);
	}
	.share-description {
		font-size: 14px;
		color: var(--secondary-text);
		margin-bottom: 12px;
	}
	.share-url-container {
		margin-bottom: 12px;
	}
	.share-url-input {
		width: 100%;
		padding: 12px;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		font-size: 14px;
		font-family: 'SF Mono', Monaco, monospace;
		background: #f8f9fa;
		color: var(--primary-text);
	}
	.share-btn {
		width: 100%;
		background: var(--ios-blue);
		color: white;
		padding: 14px;
		border: none;
		border-radius: 8px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	.share-btn:active {
		opacity: 0.7;
	}

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
</style>
