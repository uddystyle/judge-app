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

	/* モバイル最適化: 画面の高さに応じて調整 */
	@media (max-height: 700px) {
		.container {
			padding: 20px 20px;
		}
		.instruction {
			font-size: 20px;
			margin-bottom: 16px;
		}
		.scoring-info {
			margin-bottom: 16px;
		}
		.numeric-display {
			font-size: 42px !important;
			min-height: 70px !important;
			margin-bottom: 20px !important;
		}
		.nav-buttons {
			margin-top: 20px !important;
		}
	}

	@media (max-height: 650px) {
		.container {
			padding: 16px 20px;
		}
		.instruction {
			font-size: 18px;
			margin-bottom: 12px;
		}
		.scoring-info {
			margin-bottom: 12px;
		}
		.numeric-display {
			font-size: 38px !important;
			min-height: 60px !important;
			margin-bottom: 16px !important;
		}
		.nav-buttons {
			margin-top: 16px !important;
		}
	}

	@media (max-height: 600px) {
		.container {
			padding: 12px 20px;
		}
		.instruction {
			font-size: 16px;
			margin-bottom: 10px;
		}
		.scoring-info {
			margin-bottom: 10px;
		}
		.numeric-display {
			font-size: 34px !important;
			min-height: 50px !important;
			margin-bottom: 12px !important;
		}
		.nav-buttons {
			margin-top: 12px !important;
		}
	}

	.scoring-badge {
		display: inline-block;
		background: transparent;
		color: #6b7280;
		padding: 4px 12px;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		font-size: 12px;
		font-weight: 500;
		margin-bottom: 8px;
		letter-spacing: 0.01em;
	}

	.scoring-badge.advanced {
		color: #6b7280;
		border-color: #d1d5db;
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
