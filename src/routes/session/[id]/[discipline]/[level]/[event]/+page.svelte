<script lang="ts">
	import NumericKeypad from '$lib/components/NumericKeypad.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { currentBib as bibStore } from '$lib/stores';
	import { onMount } from 'svelte';
	import type { ActionData } from './$types';
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	export let form: ActionData;
	let currentBib = '';
	let formElement: HTMLFormElement;

	$: ({ id, discipline, level } = $page.params);

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

	function beforeSubmit() {
		const bib = parseInt(currentBib, 10) || 0;
		if (bib < 1 || bib > 999) {
			// SvelteKitのフォームが送信をキャンセルしてくれる
			alert('ゼッケン番号は1～999の範囲で入力してください');
			return false;
		}
		bibStore.set(bib);
		return true;
	}

	function handleConfirm() {
		const bib = parseInt(currentBib, 10) || 0;
		if (bib < 1 || bib > 999) {
			alert('ゼッケン番号は1～999の範囲で入力してください');
			return;
		}
		bibStore.set(bib);

		// フォーム要素が存在すれば、送信をリクエストする
		if (formElement) {
			formElement.requestSubmit();
		}
	}
</script>

<Header />

<div class="container">
	<div class="instruction">ゼッケン番号を入力してください</div>
	<div class="numeric-display">{currentBib || '0'}</div>

	<form method="POST" action="?/setPrompt" use:enhance bind:this={formElement}>
		<input type="hidden" name="bib" value={currentBib} />
	</form>

	<NumericKeypad on:input={handleInput} on:clear={handleClear} on:confirm={handleConfirm} />
	{#if form?.error}
		<p class="error-message">{form.error}</p>
	{/if}

	<div class="nav-buttons">
		<NavButton on:click={() => goto(`/session/${id}/${discipline}/${level}`)}>種目選択に戻る</NavButton>
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
	.error-message {
		color: var(--ios-red);
		margin-top: 1rem;
	}
</style>
