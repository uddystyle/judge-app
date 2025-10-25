<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';

	export let data: PageData;

	let selectedTab: 'overall' | number = 'overall';
	let pollingInterval: any;

	// ページをリロードして最新データを取得
	async function refreshData() {
		window.location.reload();
	}

	// 自動更新（30秒ごと）
	onMount(() => {
		pollingInterval = setInterval(() => {
			refreshData();
		}, 30000);
	});

	onDestroy(() => {
		if (pollingInterval) {
			clearInterval(pollingInterval);
		}
	});

	$: sessionId = $page.params.sessionId;
</script>

<svelte:head>
	<title>{data.sessionDetails.name} - スコアボード</title>
</svelte:head>

<div class="container">
	<div class="header-section">
		<h1 class="title">{data.sessionDetails.name}</h1>
		<p class="subtitle">スコアボード</p>
		<p class="auto-update">30秒ごとに自動更新</p>
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

	<div class="refresh-section">
		<button class="refresh-btn" on:click={refreshData}>🔄 最新データを取得</button>
	</div>
</div>

<style>
	:global(body) {
		background: #f5f5f7;
	}

	.container {
		padding: 28px 20px;
		max-width: 800px;
		margin: 0 auto;
		min-height: 100vh;
	}
	.header-section {
		text-align: center;
		margin-bottom: 28px;
	}
	.title {
		font-size: 28px;
		font-weight: 700;
		margin-bottom: 8px;
		color: #1d1d1f;
	}
	.subtitle {
		font-size: 18px;
		color: #6e6e73;
		margin-bottom: 4px;
	}
	.auto-update {
		font-size: 13px;
		color: #86868b;
	}

	.tabs {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		margin-bottom: 24px;
		padding-bottom: 8px;
		border-bottom: 2px solid #d2d2d7;
	}
	.tab {
		background: white;
		border: 1px solid #d2d2d7;
		border-radius: 8px;
		padding: 10px 16px;
		font-size: 15px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		color: #1d1d1f;
	}
	.tab.active {
		background: #0071e3;
		color: white;
		border-color: #0071e3;
	}

	.ranking-container {
		background: white;
		border-radius: 12px;
		overflow: hidden;
		margin-bottom: 24px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}
	.event-title {
		background: #f5f5f7;
		padding: 12px 16px;
		font-size: 16px;
		font-weight: 600;
		color: #1d1d1f;
		border-bottom: 1px solid #d2d2d7;
	}
	.ranking-header {
		display: grid;
		grid-template-columns: 80px 1fr 120px;
		background: #f5f5f7;
		padding: 12px 16px;
		font-size: 14px;
		font-weight: 600;
		color: #6e6e73;
		border-bottom: 1px solid #d2d2d7;
	}
	.ranking-row {
		display: grid;
		grid-template-columns: 80px 1fr 120px;
		padding: 16px;
		border-bottom: 1px solid #d2d2d7;
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
		color: #1d1d1f;
	}
	.bib-col {
		font-size: 18px;
		font-weight: 500;
		color: #1d1d1f;
	}
	.score-col {
		font-size: 20px;
		font-weight: 700;
		color: #0071e3;
		text-align: right;
	}
	.no-data {
		padding: 40px 20px;
		text-align: center;
		color: #6e6e73;
		font-size: 15px;
	}

	.refresh-section {
		text-align: center;
		margin-top: 28px;
	}
	.refresh-btn {
		background: white;
		border: 1px solid #d2d2d7;
		border-radius: 8px;
		padding: 12px 24px;
		font-size: 16px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		color: #1d1d1f;
	}
	.refresh-btn:hover {
		background: #f5f5f7;
	}
	.refresh-btn:active {
		transform: scale(0.98);
	}
</style>
