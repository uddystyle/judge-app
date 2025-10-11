<script lang="ts">
	import NumericKeypad from '$lib/components/NumericKeypad.svelte';

	let currentScore = ''; // 得点を保持する変数

	// NumericKeypadからの'input'イベントを処理する関数
	function handleInput(event: CustomEvent<string>) {
		const num = event.detail;
		if (currentScore.length < 2) {
			currentScore = currentScore === '0' && num !== '0' ? num : currentScore + num;
			if (parseInt(currentScore) > 99) currentScore = '99';
		}
	}

	// NumericKeypadからの'clear'イベントを処理する関数
	function handleClear() {
		currentScore = '';
	}

	// NumericKeypadからの'confirm'イベントを処理する関数
	function handleConfirm() {
		const score = parseInt(currentScore, 10) || 0;
		if (score < 0 || score > 99) {
			alert('得点は0-99の範囲で入力してください');
			return;
		}
		// ここで、実際の得点確定処理（API呼び出しなど）を行う
		console.log(`得点が確定されました: ${score}点`);
	}
</script>

<div class="numeric-display">{currentScore || '0'}</div>

<NumericKeypad on:input={handleInput} on:clear={handleClear} on:confirm={handleConfirm} />

<style>
	/* このページ専用のスタイル */
	.numeric-display {
		background: transparent;
		border: none;
		font-size: 48px;
		font-weight: 600;
		padding: 20px;
		margin: 0;
		min-height: 80px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--primary-text);
	}
</style>
