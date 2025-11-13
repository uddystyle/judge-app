<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import ScoreInput from '$lib/components/ScoreInput.svelte';
	import Header from '$lib/components/Header.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { currentSession, currentDiscipline, currentEvent, currentBib } from '$lib/stores';
	import { onMount } from 'svelte';

	export let data: PageData;
	export let form: ActionData;

	$: sessionId = $page.params.id;
	$: modeType = $page.params.modeType;
	$: eventId = $page.params.eventId;
	$: sessionName = data.sessionDetails.name;
	$: eventName = data.isTrainingMode ? data.eventInfo.name : data.eventInfo.event_name;
	$: bibNumber = data.bibNumber;
	$: participantId = data.participantId;
	$: minScore = data.eventInfo.min_score || 0;
	$: maxScore = data.eventInfo.max_score || 100;
	$: precision = data.eventInfo.score_precision || 1;
	$: guestIdentifier = data.guestIdentifier;
	$: formAction = guestIdentifier ? `?/submitScore&guest=${guestIdentifier}` : '?/submitScore';
	$: showBackButton = !data.isMultiJudge || data.isChief;

	let loading = false;
	let scoreInput: HTMLInputElement;

	// ヘッダー情報を設定
	onMount(() => {
		currentSession.set({ name: sessionName });
		currentDiscipline.set(data.isTrainingMode ? '研修モード' : '大会モード');
		currentEvent.set(eventName);
		currentBib.set(bibNumber);
	});

	// ScoreInputコンポーネントからのsubmitイベントを処理
	function handleSubmit(event: CustomEvent<{ score: number }>) {
		loading = true;
		// hidden inputの値を直接設定
		if (scoreInput) {
			scoreInput.value = event.detail.score.toString();
		}
		// フォームを送信
		const formElement = document.getElementById('scoreForm') as HTMLFormElement;
		if (formElement) {
			formElement.requestSubmit();
		}
	}

	// フォーム送信後の処理
	$: if (form?.success && form?.score !== undefined && form?.bibNumber) {
		// 複数検定員モードがONの場合はstatus画面へ、OFFの場合はcomplete画面へ
		const guestParam = guestIdentifier ? `&guest=${guestIdentifier}` : '';
		if (data.isMultiJudge) {
			goto(`/session/${sessionId}/score/${modeType}/${eventId}/status?bib=${form.bibNumber}${guestParam}`);
		} else {
			goto(`/session/${sessionId}/score/${modeType}/${eventId}/complete?bib=${form.bibNumber}&score=${form.score}${guestParam}`);
		}
	}

	// ゼッケン入力に戻る処理
	function handleBackToBib() {
		// ストアをクリア
		currentBib.set(null);
		// ゼッケン入力画面に戻る
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}` : '';
		goto(`/session/${sessionId}/score/${modeType}/${eventId}${guestParam}`);
	}
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	hasOrganization={data.organizations && data.organizations.length > 0}
	pageOrganizations={data.organizations || []}
	isGuest={!!data.guestIdentifier}
	guestName={data.guestParticipant?.guest_name || null}
/>

{#if form?.error}
	<div class="error-message">{form.error}</div>
{/if}

<ScoreInput
	minScore={minScore}
	maxScore={maxScore}
	maxDigits={3}
	loading={loading}
	showBackButton={showBackButton}
	on:submit={handleSubmit}
	on:back={handleBackToBib}
/>

<form id="scoreForm" method="POST" action={formAction} use:enhance style="display: none;">
	<input type="hidden" name="score" bind:this={scoreInput} />
	<input type="hidden" name="participantId" value={participantId} />
	<input type="hidden" name="bibNumber" value={bibNumber} />
</form>

<style>
	.error-message {
		background: #ffe6e6;
		border: 1px solid #dc3545;
		color: #dc3545;
		padding: 12px;
		border-radius: 8px;
		margin: 20px;
		text-align: center;
	}
</style>

