<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import NumericKeypad from '$lib/components/NumericKeypad.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { currentSession, currentDiscipline, currentEvent, currentBib } from '$lib/stores';

	export let data: PageData;
	export let form: ActionData;

	$: sessionId = $page.params.id;
	$: eventId = $page.params.eventId;
	$: sessionName = data.sessionDetails.name;
	$: eventName = data.customEvent.event_name;
	$: excludeExtremes = data.sessionDetails.exclude_extremes;
	$: guestIdentifier = data.guestIdentifier;

	let bibNumber = '';

	// アラートダイアログの状態
	let showAlert = false;
	let alertMessage = '';
	let alertTitle = '入力エラー';

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
			alertMessage = 'ゼッケン番号を入力してください';
			showAlert = true;
			return;
		}

		// フォームを送信
		const formElement = document.getElementById('bibForm') as HTMLFormElement;
		if (formElement) {
			formElement.requestSubmit();
		}
	}

	// ヘッダー情報を設定
	onMount(() => {
		// ストアを設定
		currentSession.set({ name: sessionName });
		currentDiscipline.set('大会');
		currentEvent.set(eventName);
		currentBib.set(null); // ゼッケン入力前

		// フォーム送信後の処理
		if (form?.success && form?.bibNumber) {
			// 採点状況確認画面へ遷移
			goto(`/session/${sessionId}/tournament-events/${eventId}/score/status?bib=${form.bibNumber}`);
		}
	});
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	hasOrganization={data.organizations && data.organizations.length > 0}
	pageOrganizations={data.organizations || []}
	isGuest={false}
	guestName={null}
/>

<div class="container">
	<div class="instruction">ゼッケン番号を入力してください</div>

	<div class="scoring-info">
		{#if excludeExtremes}
			<div class="scoring-badge advanced">5審3採</div>
		{:else}
			<div class="scoring-badge">3審3採</div>
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

<AlertDialog
	bind:isOpen={showAlert}
	title={alertTitle}
	message={alertMessage}
	confirmText="OK"
	on:confirm={() => {}}
/>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
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
		border-radius: 100px;
		font-size: 14px;
		font-weight: 600;
		margin-bottom: 8px;
	}

	.scoring-badge.advanced {
		background: #2d7a3e;
	}

	.scoring-description {
		font-size: 14px;
		color: var(--secondary-text);
		margin: 0;
	}

	.error-message {
		background: #ffe6e6;
		border: 1px solid #dc3545;
		color: #dc3545;
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
