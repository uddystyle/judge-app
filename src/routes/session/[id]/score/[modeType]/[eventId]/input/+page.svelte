<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import NumericKeypad from '$lib/components/NumericKeypad.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
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

	let currentScore = '';
	let loading = false;

	// ヘッダー情報を設定
	onMount(() => {
		currentSession.set({ name: sessionName });
		currentDiscipline.set(data.isTrainingMode ? '研修モード' : '大会モード');
		currentEvent.set(eventName);
		currentBib.set(bibNumber);
	});

	// キーパッドから数字が入力されたときの処理
	function handleInput(event: CustomEvent<string>) {
		const num = event.detail;
		// 整数のみ（最大3桁: 0-100）
		if (currentScore.length < 3) {
			currentScore = currentScore === '0' && num !== '0' ? num : currentScore + num;
		}
	}

	function handleClear() {
		currentScore = '';
	}

	async function handleConfirm() {
		const score = parseFloat(currentScore) || 0;

		if (score < minScore || score > maxScore) {
			alert(`得点は${minScore}～${maxScore}の範囲で入力してください`);
			return;
		}

		// 整数チェック
		if (!Number.isInteger(score)) {
			alert('得点は整数で入力してください');
			return;
		}

		loading = true;
		// フォームを送信
		const formElement = document.getElementById('scoreForm') as HTMLFormElement;
		if (formElement) {
			formElement.requestSubmit();
		}
	}

	// フォーム送信後の処理
	$: if (form?.success && form?.score !== undefined && form?.bibNumber) {
		// 複数検定員モードがONの場合はstatus画面へ、OFFの場合はcomplete画面へ
		if (data.isMultiJudge) {
			goto(`/session/${sessionId}/score/${modeType}/${eventId}/status?bib=${form.bibNumber}`);
		} else {
			goto(`/session/${sessionId}/score/${modeType}/${eventId}/complete?bib=${form.bibNumber}&score=${form.score}`);
		}
	}

	// ゼッケン入力に戻る処理
	function handleBackToBib() {
		// ストアをクリア
		currentBib.set(null);
		// ゼッケン入力画面に戻る
		goto(`/session/${sessionId}/score/${modeType}/${eventId}`);
	}
</script>

<Header />

<div class="container">
	{#if form?.error}
		<div class="error-message">{form.error}</div>
	{/if}

	<div class="numeric-display">{currentScore || '0'}</div>

	<NumericKeypad
		on:input={handleInput}
		on:clear={handleClear}
		on:confirm={handleConfirm}
	/>

	<form id="scoreForm" method="POST" action="?/submitScore" use:enhance style="display: none;">
		<input type="hidden" name="score" value={currentScore} />
		<input type="hidden" name="participantId" value={participantId} />
		<input type="hidden" name="bibNumber" value={bibNumber} />
	</form>

	{#if !data.isMultiJudge || data.isChief}
		<div class="nav-buttons">
			<NavButton on:click={handleBackToBib}>
				ゼッケン番号入力に戻る
			</NavButton>
		</div>
	{/if}
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
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
			margin: 0 auto;
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

