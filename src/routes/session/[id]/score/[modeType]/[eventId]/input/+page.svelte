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
	$: maxScore = data.eventInfo.max_score || 10;
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
		// 小数点の処理
		if (precision < 1) {
			// 小数点を含む入力を許可
			if (num === '.' && !currentScore.includes('.')) {
				currentScore = currentScore || '0' + '.';
			} else if (num !== '.' && currentScore.length < 4) {
				currentScore = currentScore === '0' && num !== '0' && !currentScore.includes('.')
					? num
					: currentScore + num;
			}
		} else {
			// 整数のみ
			if (currentScore.length < 2) {
				currentScore = currentScore === '0' && num !== '0' ? num : currentScore + num;
			}
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

		// 精度チェック
		if (precision === 1) {
			if (!Number.isInteger(score)) {
				alert('得点は整数で入力してください');
				return;
			}
		} else if (precision === 0.5) {
			if (score % 0.5 !== 0) {
				alert('得点は0.5点刻みで入力してください');
				return;
			}
		} else if (precision === 0.1) {
			if (Math.round(score * 10) / 10 !== score) {
				alert('得点は0.1点刻みで入力してください');
				return;
			}
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
		goto(`/session/${sessionId}/score/${modeType}/${eventId}/complete?bib=${form.bibNumber}&score=${form.score}`);
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

	<div class="nav-buttons">
		<NavButton on:click={handleBackToBib}>
			ゼッケン番号入力に戻る
		</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
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
		font-size: 72px;
		font-weight: 700;
		min-height: 120px;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 28px;
		color: var(--primary-orange);
		background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%);
		border: 3px solid var(--primary-orange);
		border-radius: 16px;
		padding: 20px;
		box-shadow: 0 4px 12px rgba(255, 152, 0, 0.15);
	}

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
</style>

