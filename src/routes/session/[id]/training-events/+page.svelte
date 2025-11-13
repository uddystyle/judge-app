<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';

	export let data: PageData;

	$: sessionId = $page.params.id;
	$: guestIdentifier = data.guestIdentifier;

	function selectEvent(eventId: string) {
		// 統一された採点画面へ遷移（ゲストパラメータを引き継ぐ）
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}` : '';
		goto(`/session/${sessionId}/score/training/${eventId}${guestParam}`);
	}
</script>

<svelte:head>
	<title>種目選択 - 研修モード</title>
</svelte:head>

<div class="container">

	<div class="header">
		<h1>種目選択</h1>
		<div class="session-info">
			<p class="session-name">{data.sessionDetails.name}</p>
			{#if data.isMultiJudge}
				<p class="mode-info">複数検定員モード（主任が採点指示）</p>
			{:else}
				<p class="mode-info">自由採点モード</p>
			{/if}
		</div>
	</div>

	{#if data.events.length === 0}
		<div class="empty-state">
			<p>種目が登録されていません。</p>
			<p>検定詳細ページから種目を追加してください。</p>
			<NavButton on:click={() => {
				const guestParam = guestIdentifier ? `?guest=${guestIdentifier}` : '';
				goto(`/session/${sessionId}/details${guestParam}`);
			}}>
				検定詳細へ
			</NavButton>
		</div>
	{:else}
		<div class="instruction">
			{#if data.isMultiJudge}
				<p>採点する種目を選択してください。全検定員が同じ種目を採点します。</p>
			{:else}
				<p>採点する種目を選択してください。</p>
			{/if}
		</div>

		<div class="events-grid">
			{#each data.events as event}
				<button class="event-card" on:click={() => selectEvent(event.id)}>
					<div class="event-name">{event.name}</div>
					<div class="arrow">→</div>
				</button>
			{/each}
		</div>
	{/if}

	<div class="nav-buttons">
		<NavButton variant="secondary" on:click={() => {
			const guestParam = guestIdentifier ? `?guest=${guestIdentifier}` : '';
			goto(`/session/${sessionId}${guestParam}`);
		}}>
			戻る
		</NavButton>
	</div>
</div>

<style>
	.container {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	.header {
		text-align: center;
		margin-bottom: 2rem;
	}

	h1 {
		font-size: 1.75rem;
		font-weight: 600;
		margin-bottom: 1rem;
		color: #1a1a1a;
	}

	.session-info {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.session-name {
		font-size: 1.1rem;
		font-weight: 500;
		color: #333;
	}

	.mode-info {
		font-size: 0.9rem;
		color: #666;
		background: #fff3e0;
		padding: 0.5rem 1rem;
		border-radius: 20px;
		display: inline-block;
		margin: 0 auto;
	}

	.instruction {
		text-align: center;
		margin-bottom: 2rem;
		padding: 1rem;
		background: #f5f5f5;
		border-radius: 8px;
		color: #666;
	}

	.empty-state {
		text-align: center;
		padding: 3rem 1rem;
		color: #666;
	}

	.empty-state p {
		margin-bottom: 1rem;
	}

	.events-grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 2rem;
		max-width: 600px;
		margin-left: auto;
		margin-right: auto;
	}

	.event-card {
		background: white;
		border: 2px solid #e0e0e0;
		border-radius: 12px;
		padding: 1.5rem;
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.event-card:hover {
		border-color: #ff9800;
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	.event-name {
		font-size: 1.1rem;
		font-weight: 600;
		color: #1a1a1a;
		flex: 1;
	}

	.arrow {
		font-size: 1.5rem;
		color: #ff9800;
		opacity: 0.5;
		transition: opacity 0.2s;
		margin-left: 1rem;
	}

	.event-card:hover .arrow {
		opacity: 1;
	}

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 2rem;
	}
</style>
