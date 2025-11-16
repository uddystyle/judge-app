<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import NumericKeypad from '$lib/components/NumericKeypad.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { enhance } from '$app/forms';
	import { currentSession, currentDiscipline, currentEvent, currentBib } from '$lib/stores';
	import { onMount } from 'svelte';

	export let data: PageData;
	export let form: ActionData;

	$: sessionId = $page.params.id;
	$: eventId = $page.params.eventId;
	$: modeType = $page.params.modeType;
	$: sessionName = data.sessionDetails.name;
	$: eventName = data.isTrainingMode ? data.eventInfo.name : data.eventInfo.event_name;
	$: excludeExtremes = data.excludeExtremes;
	$: isTrainingMode = data.isTrainingMode;
	$: isMultiJudge = data.isMultiJudge;
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

	// フォーム送信後の処理
	$: if (form?.success && form?.bibNumber && form?.participantId) {
		// ゼッケン番号入力後は常に得点入力画面へ
		const guestParam = guestIdentifier ? `&guest=${guestIdentifier}` : '';
		goto(`/session/${sessionId}/score/${modeType}/${eventId}/input?bib=${form.bibNumber}&participantId=${form.participantId}${guestParam}`);
	}

	// モードに応じた戻り先
	$: {
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}` : '';
		backUrl = isTrainingMode
			? `/session/${sessionId}/training-events${guestParam}`
			: `/session/${sessionId}/tournament-events${guestParam}`;
	}
	let backUrl: string;

	// ヘッダー情報を設定
	onMount(() => {
		currentSession.set({ name: sessionName });
		currentDiscipline.set(isTrainingMode ? '研修モード' : '大会モード');
		currentEvent.set(eventName);
		currentBib.set(null); // ゼッケン入力前なのでnull
	});
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	hasOrganization={data.organizations && data.organizations.length > 0}
	pageOrganizations={data.organizations || []}
	isGuest={!!data.guestIdentifier}
	guestName={data.guestParticipant?.guest_name || null}
/>

<div class="container">
	<div class="instruction">ゼッケン番号を入力してください</div>

	{#if !isTrainingMode}
		<div class="scoring-info">
			{#if excludeExtremes}
				<div class="scoring-badge advanced">5審3採</div>
			{:else}
				<div class="scoring-badge">3審3採</div>
			{/if}
		</div>
	{:else if isMultiJudge}
		<div class="scoring-info">
			<div class="scoring-badge training">複数検定員モード</div>
			<p class="scoring-description">主任が採点を指示します</p>
		</div>
	{/if}

	{#if form?.error}
		<div class="error-message">{form.error}</div>
	{/if}

	<div class="numeric-display">{bibNumber || '0'}</div>

	<NumericKeypad on:input={handleInput} on:clear={handleClear} on:confirm={handleConfirm} />

	<form id="bibForm" method="POST" action="?/submitBib{guestIdentifier ? `&guest=${guestIdentifier}` : ''}" use:enhance style="display: none;">
		<input type="hidden" name="bibNumber" value={bibNumber} />
	</form>

	<div class="nav-buttons">
		<NavButton on:click={() => goto(backUrl)}>
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
		max-width: 600px;
		margin: 0 auto;
	}

	.instruction {
		font-size: 24px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 28px;
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

	.scoring-badge.training {
		background: #ff9800;
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
		font-size: 64px;
		font-weight: 700;
		color: var(--accent-primary);
		min-height: 100px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-primary);
		border-radius: 16px;
		border: 3px solid var(--border-light);
		margin-bottom: 24px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
	}

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 800px;
		}
		.instruction {
			font-size: 32px;
			margin-bottom: 40px;
		}
		.numeric-display {
			font-size: 96px;
			min-height: 140px;
			border-radius: 20px;
			margin-bottom: 32px;
		}
		.nav-buttons {
			margin-top: 40px;
		}
	}
</style>
