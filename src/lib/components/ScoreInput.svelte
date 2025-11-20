<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import NumericKeypad from './NumericKeypad.svelte';
	import NavButton from './NavButton.svelte';
	import AlertDialog from './AlertDialog.svelte';
	import LoadingSpinner from './LoadingSpinner.svelte';

	// Props
	export let minScore: number = 0;
	export let maxScore: number = 99;
	export let maxDigits: number = 2;
	export let loading: boolean = false;
	export let disabled: boolean = false;
	export let showBackButton: boolean = true;
	export let instructionText: string = '得点を入力してください';

	// Events
	const dispatch = createEventDispatcher<{
		submit: { score: number };
		back: void;
		error: { title: string; message: string };
	}>();

	// Internal state
	let currentScore = '';
	let showAlert = false;
	let alertMessage = '';
	let alertTitle = '入力エラー';

	// Event handlers
	function handleInput(event: CustomEvent<string>) {
		const num = event.detail;
		if (currentScore.length < maxDigits) {
			currentScore = currentScore === '0' && num !== '0' ? num : currentScore + num;
		}
	}

	function handleClear() {
		currentScore = '';
	}

	function handleConfirm() {
		const score = parseFloat(currentScore) || 0;

		// Validation: Range check
		if (score < minScore || score > maxScore) {
			alertTitle = '入力エラー';
			alertMessage = `得点は${minScore}～${maxScore}の範囲で入力してください`;
			showAlert = true;
			dispatch('error', { title: alertTitle, message: alertMessage });
			return;
		}

		// Validation: Integer check
		if (!Number.isInteger(score)) {
			alertTitle = '入力エラー';
			alertMessage = '得点は整数で入力してください';
			showAlert = true;
			dispatch('error', { title: alertTitle, message: alertMessage });
			return;
		}

		// Dispatch submit event (parent handles submission)
		dispatch('submit', { score });
	}

	function handleBack() {
		dispatch('back');
	}
</script>

<div class="container">
	<div class="instruction">{instructionText}</div>

	<div class="numeric-display">{currentScore || '0'}</div>

	<NumericKeypad
		on:input={handleInput}
		on:clear={handleClear}
		on:confirm={handleConfirm}
		disabled={loading || disabled}
	/>

	{#if loading}
		<div class="loading-overlay">
			<LoadingSpinner size="large" />
			<p class="loading-text">送信中...</p>
		</div>
	{/if}

	{#if showBackButton}
		<div class="nav-buttons">
			<NavButton on:click={handleBack}>ゼッケン番号入力に戻る</NavButton>
		</div>
	{/if}
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
	.loading-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		color: white;
	}
	.loading-text {
		margin-top: 16px;
		font-size: 18px;
		font-weight: 600;
	}

	/* モバイル最適化: 画面の高さに応じて調整 */
	@media (max-height: 700px) {
		.container {
			padding: 20px 20px;
		}
		.instruction {
			font-size: 20px;
			margin-bottom: 20px;
		}
		.numeric-display {
			font-size: 52px;
			min-height: 80px;
			margin-bottom: 20px;
		}
		.nav-buttons {
			margin-top: 20px;
		}
	}

	@media (max-height: 650px) {
		.container {
			padding: 16px 20px;
		}
		.instruction {
			font-size: 18px;
			margin-bottom: 16px;
		}
		.numeric-display {
			font-size: 46px;
			min-height: 70px;
			margin-bottom: 16px;
		}
		.nav-buttons {
			margin-top: 16px;
		}
	}

	@media (max-height: 600px) {
		.container {
			padding: 12px 20px;
		}
		.instruction {
			font-size: 16px;
			margin-bottom: 12px;
		}
		.numeric-display {
			font-size: 40px;
			min-height: 60px;
			margin-bottom: 12px;
		}
		.nav-buttons {
			margin-top: 12px;
		}
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) and (min-height: 701px) {
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
