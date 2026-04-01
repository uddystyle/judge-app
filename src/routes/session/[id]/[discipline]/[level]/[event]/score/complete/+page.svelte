<script lang="ts">
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { currentBib as bibStore, currentSession, currentDiscipline, currentLevel, currentEvent } from '$lib/stores';
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { getContext, onMount, onDestroy } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { createSessionMonitorWithPolling, type RealtimeChannelHandle } from '$lib/realtime';

	export let data: PageData;

	const supabase = getContext<SupabaseClient>('supabase');

	$: guestIdentifier = data.guestIdentifier;
	$: guestParam = guestIdentifier ? `?guest=${guestIdentifier}` : '';

	let endSessionForm: HTMLFormElement;
	let changeEventForm: HTMLFormElement;
	let sessionMonitorHandle: RealtimeChannelHandle | null = null;
	let previousIsActive: boolean | null = null;
	let previousActivePromptId: string | null = null;

	function handleNextSkier() {
		bibStore.set(null);
		const bibInputPath = $page.url.pathname.replace('/score/complete', '');
		const guestIdentifier = $page.url.searchParams.get('guest');
		goto(`${bibInputPath}`);
	}

	function handleEndSession() {
		// フォームを送信
		if (endSessionForm) {
			endSessionForm.requestSubmit();
		}
	}

	function handleChangeEvent() {
		// フォームを送信
		if (changeEventForm) {
			changeEventForm.requestSubmit();
		}
	}

	onMount(() => {
		// ヘッダー情報を設定
		if (data.sessionDetails) {
			currentSession.set(data.sessionDetails);
		}
		currentDiscipline.set($page.params.discipline);
		currentLevel.set($page.params.level);
		currentEvent.set($page.params.event);

		// 一般検定員の場合、セッション終了を監視
		if (!data.isChief) {
			const sessionId = $page.params.id || '';

			sessionMonitorHandle = createSessionMonitorWithPolling(supabase, {
				sessionId,
				channelPrefix: 'session-end',
				onRealtimePayload: async (payload) => {
					const isActive = payload.new.is_active;
					const activePromptId = payload.new.active_prompt_id;
					const oldActivePromptId = payload.old.active_prompt_id;

					if (isActive === false) {
						goto(`/session/${sessionId}?ended=true`);
					} else if (activePromptId === null && oldActivePromptId !== null) {
						goto(`/session/${sessionId}?${guestParam.substring(1)}`);
					} else if (activePromptId && activePromptId !== oldActivePromptId) {
						const { data: promptData, error } = await supabase
							.from('scoring_prompts')
							.select('*')
							.eq('id', activePromptId)
							.single();

						if (!error && promptData) {
							bibStore.set(promptData.bib_number);
							goto(`/session/${sessionId}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score`);
						}
					}
				},
				onPollingData: async (sessionData) => {
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
						previousIsActive = isActive;
						return;
					}

					// 種目変更を検知
					if (activePromptId === null && previousActivePromptId !== null) {
						goto(`/session/${sessionId}?${guestParam.substring(1)}`);
						previousActivePromptId = activePromptId;
						return;
					}

					// 新しい採点指示を検知
					if (activePromptId && activePromptId !== previousActivePromptId) {
						const { data: promptData, error } = await supabase
							.from('scoring_prompts')
							.select('*')
							.eq('id', activePromptId)
							.single();

						if (!error && promptData) {
							bibStore.set(promptData.bib_number);
							goto(`/session/${sessionId}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score`);
							previousActivePromptId = activePromptId;
							return;
						}
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
			<h3 class="scores-title">{m.score_judgeScores()}</h3>
			<div class="scores-list">
				{#each data.scores as score}
					<div class="score-item">
						<span class="judge-name">{score.judge_name}</span>
						<span class="score-value">{m.score_points({ score: score.score })}</span>
					</div>
				{/each}
			</div>
			<div class="average-score">
				<strong>
					{#if data.isTournamentMode}
						{m.score_points({ score: data.averageScore })}
					{:else}
						平均点: {m.score_points({ score: data.averageScore })}
					{/if}
				</strong>
			</div>
		</div>
	{:else}
		<div class="single-score">
			<strong>得点: {m.score_points({ score: data.averageScore })}</strong>
		</div>
	{/if}

	<div class="nav-buttons">
		<NavButton variant="primary" on:click={handleNextSkier}>次の滑走者</NavButton>
		{#if data.isChief || !data.isMultiJudge}
			<NavButton on:click={handleChangeEvent}>種目を変更する</NavButton>
		{/if}
		{#if data.isChief || !data.isMultiJudge}
			<NavButton on:click={handleEndSession}>
				セッションを終了する
			</NavButton>
		{/if}
	</div>

	<!-- 非表示のフォーム -->
	{#if typeof window !== 'undefined'}
		{@const guestQuery = guestParam ? `` : ''}
		<form bind:this={endSessionForm} method="POST" action="?/endSession{guestQuery}" use:enhance style="display: none;">
		</form>
		<form
			bind:this={changeEventForm}
			method="POST"
			action="?/changeEvent{guestQuery}"
			use:enhance
			style="display: none;"
		></form>
	{/if}
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

	/* PC対応: タブレット以上 */
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
