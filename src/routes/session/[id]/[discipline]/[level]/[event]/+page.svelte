<script lang="ts">
	import NumericKeypad from '$lib/components/NumericKeypad.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { currentBib as bibStore, currentDiscipline, currentLevel, currentEvent } from '$lib/stores';
	import { onMount } from 'svelte';
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	export let form: ActionData;
	export let data: PageData;
	let currentBib = '';
	let formElement: HTMLFormElement;

	$: ({ id, discipline, level, event } = $page.params);
	$: isTournamentMode = data.isTournamentMode;

	onMount(() => {
		currentBib = '';
		bibStore.set(null);
		// 種別、級、種目を設定
		currentDiscipline.set(discipline);
		currentLevel.set(level);
		currentEvent.set(event);
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
		<NavButton on:click={() => goto(isTournamentMode ? `/session/${id}/tournament-events` : `/session/${id}/${discipline}/${level}`)}>
			種目選択に戻る
		</NavButton>
	</div>
</div>

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
		color: var(--primary-orange);
		min-height: 100px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-white);
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
	.error-message {
		color: var(--ios-red);
		margin-top: 1rem;
		font-size: 14px;
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
		.error-message {
			font-size: 16px;
		}
		.nav-buttons {
			margin-top: 40px;
		}
	}
</style>
