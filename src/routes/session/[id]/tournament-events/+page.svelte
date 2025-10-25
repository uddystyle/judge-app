<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	export let data: PageData;

	$: sessionId = $page.params.id;
	$: sessionName = data.sessionDetails.name;
	$: customEvents = data.customEvents;

	function selectEvent(event: any) {
		// 既存の採点フローを使用（discipline='大会', level='共通'）
		goto(`/session/${sessionId}/${event.discipline}/${event.level}/${event.event_name}`);
	}
</script>

<Header />

<div class="container">
	<div class="session-info">
		<div class="session-name">{sessionName}</div>
		<div class="page-title">種目選択</div>
	</div>

	<div class="instruction">採点する種目を選択してください</div>

	<div class="events-grid">
		{#each customEvents as event, index}
			<NavButton on:click={() => selectEvent(event)}>
				<div class="event-content">
					<span class="event-number">{index + 1}</span>
					<span class="event-name">{event.event_name}</span>
				</div>
			</NavButton>
		{/each}
	</div>

	<div class="nav-buttons">
		<NavButton variant="secondary" on:click={() => goto('/dashboard')}>
			ダッシュボードに戻る
		</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 600px;
		margin: 0 auto;
	}

	.session-info {
		margin-bottom: 28px;
	}

	.session-name {
		font-size: 16px;
		color: var(--secondary-text);
		margin-bottom: 8px;
	}

	.page-title {
		font-size: 28px;
		font-weight: 700;
		color: var(--primary-text);
	}

	.instruction {
		font-size: 16px;
		color: var(--secondary-text);
		margin-bottom: 28px;
		line-height: 1.6;
	}

	.events-grid {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-bottom: 28px;
	}

	.event-content {
		display: flex;
		align-items: center;
		gap: 12px;
		justify-content: center;
	}

	.event-number {
		background: var(--ios-blue);
		color: white;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
		font-weight: 600;
	}

	.event-name {
		font-size: 18px;
		font-weight: 600;
	}

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
</style>
