<script lang="ts">
	import type { PageData } from './$types';
	import Header from '$lib/components/Header.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { currentSession, currentDiscipline, currentEvent } from '$lib/stores';
	import { onMount } from 'svelte';

	export let data: PageData;

	// 選択された種目（デフォルトは「全て」を表示）
	let selectedEventId: string | null = null; // null = 全て表示

	// 選択された種目のスコアをフィルタリング
	$: filteredScores = selectedEventId
		? data.myScores.filter(score => score.event_id === selectedEventId)
		: data.myScores;

	// 選択された種目の名前を取得
	$: selectedEventName = selectedEventId
		? data.allEvents.find(e => e.id === selectedEventId)?.name || ''
		: '全て';

	onMount(() => {
		// ヘッダー情報を設定
		currentSession.set({ name: data.sessionDetails?.name || '' });
		currentDiscipline.set(data.isTrainingMode ? '研修モード' : '大会モード');
		currentEvent.set(data.eventInfo?.name || data.eventInfo?.event_name || '');
	});

	function goBack() {
		const guestParam = data.guestIdentifier ? `?guest=${data.guestIdentifier}&join=true` : '';
		goto(`/session/${$page.params.id}${guestParam}`);
	}

	function selectEvent(eventId: string | null) {
		selectedEventId = eventId;
	}
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	isGuest={!!data.guestIdentifier}
	guestName={data.guestParticipant?.guest_name || null}
/>

<div class="container">
	<div class="instruction">入力結果</div>

	<div class="info-box">
		<p>あなたが入力した採点結果を表示しています。</p>
	</div>

	<!-- 種目タブ -->
	{#if data.allEvents && data.allEvents.length > 0}
		<div class="tabs-container">
			<button
				class="tab-button"
				class:active={selectedEventId === null}
				on:click={() => selectEvent(null)}
			>
				全て
			</button>
			{#each data.allEvents as event}
				<button
					class="tab-button"
					class:active={selectedEventId === event.id}
					on:click={() => selectEvent(event.id)}
				>
					{event.name}
				</button>
			{/each}
		</div>
	{/if}

	<div class="form-container">
		<h3 class="settings-title">採点一覧</h3>
		{#if filteredScores && filteredScores.length > 0}
			<div class="scores-list">
				{#each filteredScores as score}
					<div class="score-item">
						{#if selectedEventId === null}
							<div class="score-header">
								<span class="event-badge">{score.event_name}</span>
							</div>
						{/if}
						<div class="score-info">
							<span class="bib-number">{score.bib_number}番</span>
							<span class="score-value">{score.score} 点</span>
						</div>
					</div>
				{/each}
			</div>

			<div class="summary-box">
				<p>
					{#if selectedEventId === null}
						合計 <strong>{filteredScores.length}件</strong> の採点を入力しました
					{:else}
						この種目で <strong>{filteredScores.length}件</strong> の採点を入力しました
					{/if}
				</p>
			</div>
		{:else}
			<div class="empty-state">
				<p>
					{#if selectedEventId === null}
						まだ採点結果を入力していません。
					{:else}
						この種目の採点結果はありません。
					{/if}
				</p>
			</div>
		{/if}
	</div>

	<div class="nav-buttons">
		<NavButton variant="secondary" on:click={goBack}>セッションに戻る</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		max-width: 500px;
		margin: 0 auto;
		text-align: center;
	}

	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 20px;
	}

	.info-box {
		background: #f0f4ff;
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 24px;
		text-align: left;
	}

	.info-box p {
		margin: 0;
		font-size: 14px;
		color: #374151;
		line-height: 1.6;
	}

	.tabs-container {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		padding: 4px;
		margin-bottom: 24px;
		-webkit-overflow-scrolling: touch;
	}

	.tabs-container::-webkit-scrollbar {
		height: 4px;
	}

	.tabs-container::-webkit-scrollbar-track {
		background: #f1f1f1;
		border-radius: 4px;
	}

	.tabs-container::-webkit-scrollbar-thumb {
		background: #888;
		border-radius: 4px;
	}

	.tabs-container::-webkit-scrollbar-thumb:hover {
		background: #555;
	}

	.tab-button {
		flex-shrink: 0;
		padding: 10px 20px;
		background: white;
		border: 2px solid #e5e7eb;
		border-radius: 8px;
		font-size: 15px;
		font-weight: 600;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.tab-button:hover {
		border-color: #d1d5db;
		background: #f9fafb;
	}

	.tab-button.active {
		background: var(--ios-blue);
		border-color: var(--ios-blue);
		color: white;
	}

	.tab-button.active:hover {
		opacity: 0.9;
	}

	.form-container {
		margin-bottom: 1.5rem;
	}

	.settings-title {
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 0.5rem;
		text-align: left;
	}

	.scores-list {
		background: white;
		border-radius: 12px;
		padding: 8px 16px;
		margin-bottom: 16px;
	}

	.score-item {
		padding: 16px 0;
		border-bottom: 1px solid var(--separator-gray);
	}

	.score-item:last-child {
		border-bottom: none;
	}

	.score-header {
		margin-bottom: 8px;
	}

	.event-badge {
		display: inline-block;
		font-size: 13px;
		font-weight: 600;
		color: #6b7280;
		background: #f3f4f6;
		padding: 4px 10px;
		border-radius: 6px;
	}

	.score-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.bib-number {
		font-size: 16px;
		font-weight: 600;
		color: #374151;
	}

	.score-value {
		font-size: 20px;
		font-weight: 700;
		color: var(--ios-blue);
	}

	.summary-box {
		background: white;
		border-radius: 12px;
		padding: 16px;
		text-align: center;
	}

	.summary-box p {
		margin: 0;
		font-size: 15px;
		color: #6b7280;
	}

	.summary-box strong {
		color: var(--ios-blue);
		font-weight: 700;
	}

	.empty-state {
		background: white;
		border-radius: 12px;
		padding: 40px 20px;
		text-align: center;
	}

	.empty-state p {
		margin: 0;
		font-size: 15px;
		color: #9ca3af;
	}

	.nav-buttons {
		margin-top: 1.5rem;
	}
</style>
