<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import NumericKeypad from '$lib/components/NumericKeypad.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';

	export let data: PageData;
	export let form: ActionData;

	$: sessionId = $page.params.id;
	$: eventId = $page.params.eventId;
	$: sessionName = data.sessionDetails.name;
	$: eventName = data.customEvent.event_name;
	$: excludeExtremes = data.sessionDetails.exclude_extremes;

	let bibNumber = '';

	function handleInput(event: CustomEvent<string>) {
		const num = event.detail;
		if (bibNumber.length < 3) {
			bibNumber = bibNumber === '0' && num !== '0' ? num : bibNumber + num;
		}
	}

	function handleClear() {
		bibNumber = '';
	}

	async function handleConfirm() {
		if (!bibNumber || parseInt(bibNumber) <= 0) {
			alert('ゼッケン番号を入力してください');
			return;
		}

		// フォームを送信
		const formElement = document.getElementById('bibForm') as HTMLFormElement;
		if (formElement) {
			formElement.requestSubmit();
		}
	}

	// フォーム送信後の処理
	onMount(() => {
		if (form?.success && form?.bibNumber) {
			// 採点状況確認画面へ遷移
			goto(`/session/${sessionId}/tournament-events/${eventId}/score/status?bib=${form.bibNumber}`);
		}
	});
</script>

<Header />

<div class="container">
	<div class="session-info">
		<div class="session-name">{sessionName}</div>
		<div class="event-name">{eventName}</div>
	</div>

	<div class="instruction">ゼッケン番号を入力してください</div>

	<div class="scoring-info">
		{#if excludeExtremes}
			<div class="scoring-badge advanced">5審3採</div>
			<p class="scoring-description">5人の検定員で採点します</p>
		{:else}
			<div class="scoring-badge">3審3採</div>
			<p class="scoring-description">3人の検定員で採点します</p>
		{/if}
	</div>

	{#if form?.error}
		<div class="error-message">{form.error}</div>
	{/if}

	<div class="numeric-display">{bibNumber || '0'}</div>

	<NumericKeypad on:input={handleInput} on:clear={handleClear} on:confirm={handleConfirm} />

	<form id="bibForm" method="POST" action="?/submitBib" use:enhance style="display: none;">
		<input type="hidden" name="bibNumber" value={bibNumber} />
	</form>

	<div class="nav-buttons">
		<NavButton on:click={() => goto(`/session/${sessionId}/tournament-events`)}>
			種目選択に戻る
		</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
	}

	.session-info {
		margin-bottom: 20px;
	}

	.session-name {
		font-size: 14px;
		color: var(--secondary-text);
		margin-bottom: 4px;
	}

	.event-name {
		font-size: 20px;
		font-weight: 600;
		color: var(--primary-text);
	}

	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 20px;
	}

	.scoring-info {
		margin-bottom: 20px;
	}

	.scoring-badge {
		display: inline-block;
		background: var(--ios-blue);
		color: white;
		padding: 6px 16px;
		border-radius: 20px;
		font-size: 14px;
		font-weight: 600;
		margin-bottom: 8px;
	}

	.scoring-badge.advanced {
		background: var(--ios-green);
	}

	.scoring-description {
		font-size: 14px;
		color: var(--secondary-text);
		margin: 0;
	}

	.error-message {
		background: #ffe6e6;
		border: 1px solid var(--ios-red);
		color: var(--ios-red);
		padding: 12px;
		border-radius: 8px;
		margin-bottom: 20px;
		text-align: center;
	}

	.numeric-display {
		font-size: 48px;
		font-weight: 700;
		min-height: 80px;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 28px;
	}

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
</style>
