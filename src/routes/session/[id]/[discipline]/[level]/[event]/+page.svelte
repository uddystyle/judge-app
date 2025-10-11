<script lang="ts">
	import NumericKeypad from '$lib/components/NumericKeypad.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { currentBib as bibStore } from '$lib/stores';
	import { onMount } from 'svelte';

	let currentBib = '';

	onMount(() => {
		currentBib = '';
		bibStore.set(null);
	});

	// キーパッドから数字が入力されたときの処理
	function handleInput(event: CustomEvent<string>) {
		const num = event.detail;
		if (currentBib.length < 3) {
			currentBib = currentBib === '0' && num !== '0' ? num : currentBib + num;
		}
	}

	// クリアボタンが押されたときの処理
	function handleClear() {
		currentBib = '';
	}

	// 確定ボタンが押されたときの処理
	function handleConfirm() {
		const bib = parseInt(currentBib, 10) || 0;
		if (bib < 1 || bib > 999) {
			alert('ゼッケン番号は1～999の範囲で入力してください');
			return;
		}

		bibStore.set(bib);
		// 次のステップ（得点入力画面）へ移動
		// 現在のURLの末尾に "/score" を追加して遷移
		goto(`${$page.url.pathname}/score`);
	}
</script>

<Header />

<div class="container">
	<div class="instruction">ゼッケン番号を入力してください</div>

	<div class="numeric-display">{currentBib || '0'}</div>

	<NumericKeypad on:input={handleInput} on:clear={handleClear} on:confirm={handleConfirm} />

	<div class="nav-buttons">
		<NavButton on:click={() => window.history.back()}>種目選択に戻る</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 28px;
	}
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
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
</style>
