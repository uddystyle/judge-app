<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import Header from '$lib/components/Header.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import { enhance } from '$app/forms';

	export let data: PageData;
	let scoreStatus: any = { scores: [], requiredJudges: 1 };
	let pollingInterval: any;

	const { id, discipline, level, event } = $page.params;
	// Get the bib number from the URL query parameters
	const bib = $page.url.searchParams.get('bib');

	async function fetchStatus() {
		const response = await fetch(
			`/api/score-status/${id}/${bib}?discipline=${discipline}&level=${level}&event=${event}`
		);
		if (response.ok) {
			scoreStatus = await response.json();
			console.log('✅ サーバーから取得したデータ:', scoreStatus);
		}
	}

	onMount(() => {
		fetchStatus();
		pollingInterval = setInterval(fetchStatus, 3000); // Poll every 3 seconds
	});

	onDestroy(() => {
		clearInterval(pollingInterval); // Stop polling when leaving the page
	});

	let isChief = false;
	$: isChief = data.session?.user.id === scoreStatus?.chiefJudgeId;

	let canSubmit = false;
	$: canSubmit = (scoreStatus?.scores?.length || 0) >= (scoreStatus?.requiredJudges || 1);
</script>

<Header />

<!-- <div class="container">
	<div class="instruction">採点内容の確認</div>
	<div class="form-container">
		<div class="current-bib-display">採点対象: <strong>{bib}番</strong></div>
		<h3 class="settings-title">各検定員の得点</h3>
		<div class="participants-container">
			{#if scoreStatus.scores.length > 0}
				{#each scoreStatus.scores as s}
					<div class="participant-item">
						<span class="participant-name">{s.judge_name}</span>
						<span class="score-value">{s.score} 点</span>
					</div>
				{/each}
			{:else}
				<p>採点結果を待っています...</p>
			{/if}
		</div>
	</div>

	<div class="status-message">
		{#if isChief()}
			<p>
				現在の採点者数: <strong
					>{scoreStatus.scores.length} / {scoreStatus.requiredJudges} 人</strong
				>
			</p>
			<div class="nav-buttons">
				<NavButton variant="primary" disabled={!canSubmit()}>
					{canSubmit() ? 'この内容で送信する' : '採点者不足'}
				</NavButton>
			</div>
		{:else}
			<p>主任検定員が内容を確認中です...</p>
		{/if}
	</div>
</div> -->

<div class="container">
	<div class="instruction">採点内容の確認</div>
	<div class="form-container">
		<div class="current-bib-display">採点対象: <strong>{bib}番</strong></div>
		<h3 class="settings-title">各検定員の得点</h3>
		<div class="participants-container">
			{#if scoreStatus.scores && scoreStatus.scores.length > 0}
				{#each scoreStatus.scores as s}
					<div class="participant-item">
						<span class="participant-name">{s.judge_name}</span>
						<span class="score-value">{s.score} 点</span>
					</div>
				{/each}
			{:else}
				<p>採点結果を待っています...</p>
			{/if}
		</div>
	</div>

	<div class="status-message">
		{#if isChief}
			<p>
				現在の採点者数: <strong
					>{scoreStatus.scores?.length || 0} / {scoreStatus.requiredJudges || 1} 人</strong
				>
			</p>
			<form method="POST" action="/session/{id}/details?/finalizeScore" use:enhance>
				<div class="nav-buttons">
					<NavButton variant="primary" type="submit" disabled={!canSubmit}>
						{canSubmit
							? 'この内容で送信する'
							: `(${scoreStatus.requiredJudges || 1}人の採点が必要です)`}
					</NavButton>
				</div>
			</form>
		{:else}
			<p>主任検定員が内容を確認中です...</p>
		{/if}
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
		margin-bottom: 28px;
	}
	.form-container {
		margin-bottom: 1.5rem;
	}
	.current-bib-display {
		margin-bottom: 20px;
		font-size: 18px;
	}
	.settings-title {
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 0.5rem;
		text-align: left;
	}
	.participants-container {
		background: white;
		border-radius: 12px;
		padding: 8px 16px;
		min-height: 100px;
	}
	.participant-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 0;
		border-bottom: 1px solid var(--separator-gray);
	}
	.participant-item:last-child {
		border-bottom: none;
	}
	.participant-name {
		font-weight: 500;
	}
	.score-value {
		font-size: 18px;
		font-weight: 600;
		color: var(--ios-blue);
	}
	.status-message {
		color: var(--secondary-text);
		margin-top: 20px;
	}
	.nav-buttons {
		margin-top: 1rem;
	}
</style>
