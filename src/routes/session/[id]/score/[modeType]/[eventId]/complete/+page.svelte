<script lang="ts">
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { currentBib as bibStore } from '$lib/stores';
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { supabase } from '$lib/supabaseClient';
	import { onMount, onDestroy } from 'svelte';
	import { createSessionMonitorWithPolling, type RealtimeChannelHandle } from '$lib/realtime';

	export let data: PageData;

	$: sessionId = $page.params.id || '';
	$: modeType = $page.params.modeType;
	$: eventId = $page.params.eventId;
	$: guestIdentifier = data.guestIdentifier;
	$: guestParam = guestIdentifier ? `` : '';
	$: eventListUrl = data.isTrainingMode ? `/session/${sessionId}/training-events` : `/session/${sessionId}/tournament-events`;

	let endSessionForm: HTMLFormElement;
	let changeEventForm: HTMLFormElement;
	let sessionMonitorHandle: RealtimeChannelHandle | null = null;
	let previousIsActive: boolean | null = null;
	let previousActivePromptId: string | null = null;

	function handleNextAthlete() {
		bibStore.set(null);
		goto(`/session/${sessionId}/score/${modeType}/${eventId}`);
	}

	function handleEndSession() {
		if (endSessionForm) {
			endSessionForm.requestSubmit();
		}
	}

	function handleChangeEvent() {
		if (changeEventForm) {
			changeEventForm.requestSubmit();
		}
	}

	function handleViewResults() {
		goto(`/session/${sessionId}/score/${modeType}/${eventId}/results`);
	}

	onMount(() => {
		// 一般検定員かつ複数検定員モードの場合、セッション終了を監視
		const shouldMonitorSession = !data.isChief && data.isMultiJudge;

		if (shouldMonitorSession) {
			sessionMonitorHandle = createSessionMonitorWithPolling(supabase, {
				sessionId,
				channelPrefix: 'session-end',
				onRealtimePayload: async (payload) => {
					const isActive = payload.new.is_active;
					const activePromptId = payload.new.active_prompt_id;

					if (isActive === false) {
						goto(`/session/${sessionId}?ended=true`);
					} else if (activePromptId === null && payload.old.active_prompt_id !== null) {
						goto(`/session/${sessionId}`);
					}
				},
				onPollingData: (sessionData) => {
					const isActive = sessionData.is_active;
					const activePromptId = sessionData.active_prompt_id;

					// 初回のポーリング
					if (previousIsActive === null) {
						previousIsActive = isActive;
						previousActivePromptId = activePromptId;
						return;
					}

					// セッション終了を検知
					if (isActive === false && previousIsActive === true) {
						goto(`/session/${sessionId}?ended=true`);
					}

					// 種目変更を検知
					if (previousActivePromptId !== null && activePromptId === null) {
						goto(`/session/${sessionId}`);
					}

					previousIsActive = isActive;
					previousActivePromptId = activePromptId;
				}
			});
		}
	});

	onDestroy(() => {
		sessionMonitorHandle?.cleanup();
	});
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	isGuest={!!data.guestIdentifier}
	guestName={data.guestParticipant?.guest_name || null}
/>

<div class="container">
	<div class="instruction">送信完了</div>
	<div class="status">
		データが正常に送信されました<br />
		<strong>ゼッケン{data.bib}番</strong>
	</div>

	{#if data.isMultiJudge && data.scores.length > 1}
		<div class="scores-container">
			<h3 class="scores-title">各検定員の得点</h3>
			<div class="scores-list">
				{#each data.scores as score}
					<div class="score-item">
						<span class="judge-name">{score.judge_name}</span>
						<span class="score-value">{score.score}点</span>
					</div>
				{/each}
			</div>
			<div class="average-score">
				<strong>
					{#if data.isTrainingMode}
						平均点: {data.displayScore}点
					{:else}
						合計点: {data.displayScore}点
					{/if}
				</strong>
			</div>
		</div>
	{:else}
		<div class="single-score">
			<strong>得点: {data.displayScore}点</strong>
		</div>
	{/if}

	<div class="nav-buttons">
		<NavButton variant="primary" on:click={handleNextAthlete}>次の滑走者</NavButton>
		<NavButton variant="secondary" on:click={handleViewResults}>結果を見る</NavButton>
		{#if data.isChief || !data.isMultiJudge}
			<NavButton on:click={handleChangeEvent}>種目を変更する</NavButton>
			<NavButton on:click={handleEndSession}>
				セッションを終了する
			</NavButton>
		{/if}
	</div>

	<!-- 非表示のフォーム -->
	<form bind:this={endSessionForm} method="POST" action="?/endSession{guestIdentifier ? `` : ''}" use:enhance style="display: none;"></form>
	<form bind:this={changeEventForm} method="POST" action="?/changeEvent{guestIdentifier ? `` : ''}" use:enhance style="display: none;"></form>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 600px;
		margin: 0 auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 28px;
	}
	.status {
		padding: 20px;
		border-radius: 12px;
		margin: 20px auto;
		text-align: center;
		font-size: 16px;
		max-width: 400px;
		background: #e6f6e8;
		border: 2px solid #2d7a3e;
		color: #1e5c2e;
		line-height: 1.6;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.scores-container {
		max-width: 500px;
		margin: 20px auto;
		text-align: left;
	}
	.scores-title {
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 12px;
		text-align: center;
		color: var(--text-primary);
	}
	.scores-list {
		background: var(--bg-primary);
		border-radius: 12px;
		padding: 8px 16px;
		margin-bottom: 16px;
		border: 2px solid var(--border-light);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}
	.score-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 0;
		border-bottom: 1px solid var(--separator-gray);
	}
	.score-item:last-child {
		border-bottom: none;
	}
	.judge-name {
		font-weight: 500;
		color: var(--text-primary);
	}
	.score-value {
		font-size: 18px;
		font-weight: 600;
		color: var(--accent-primary);
	}
	.average-score {
		text-align: center;
		font-size: 20px;
		color: #2d7a3e;
		padding: 16px;
		background: #e6f6e8;
		border-radius: 12px;
		border: 2px solid #2d7a3e;
	}
	.single-score {
		text-align: center;
		font-size: 24px;
		font-weight: 700;
		color: var(--accent-primary);
		margin: 20px 0;
	}

	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 800px;
		}
		.instruction {
			font-size: 36px;
			margin-bottom: 40px;
		}
		.status {
			padding: 24px;
			font-size: 18px;
			max-width: 500px;
		}
		.scores-container {
			max-width: 600px;
		}
		.scores-title {
			font-size: 22px;
		}
		.scores-list {
			padding: 12px 24px;
		}
		.score-item {
			padding: 16px 0;
		}
		.judge-name {
			font-size: 18px;
		}
		.score-value {
			font-size: 22px;
		}
		.average-score {
			font-size: 24px;
			padding: 20px;
		}
		.single-score {
			font-size: 32px;
		}
		.nav-buttons {
			margin-top: 40px;
		}
	}
</style>
