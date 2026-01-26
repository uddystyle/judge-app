<script lang="ts">
	import type { PageData } from './$types';
	import Header from '$lib/components/Header.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { currentSession, currentDiscipline, currentEvent } from '$lib/stores';
	import { onMount } from 'svelte';

	export let data: PageData;

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

	<div class="form-container">
		<h3 class="settings-title">採点一覧</h3>
		{#if data.myScores && data.myScores.length > 0}
			<div class="scores-list">
				{#each data.myScores as score}
					<div class="score-item">
						<div class="score-info">
							<span class="bib-number">{score.bib_number}番</span>
							<span class="score-value">{score.score} 点</span>
						</div>
					</div>
				{/each}
			</div>

			<div class="summary-box">
				<p>合計 <strong>{data.myScores.length}件</strong> の採点を入力しました</p>
			</div>
		{:else}
			<div class="empty-state">
				<p>まだ採点結果を入力していません。</p>
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
