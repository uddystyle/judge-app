<script lang="ts">
	import NumericKeypad from '$lib/components/NumericKeypad.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import { currentBib as bibStore, currentSession, currentDiscipline, currentLevel, currentEvent } from '$lib/stores';
	import { onMount } from 'svelte';
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	export let form: ActionData;
	export let data: PageData;
	let currentBib = '';
	let formElement: HTMLFormElement;

	// アラートダイアログの状態
	let showAlert = false;
	let alertMessage = '';
	let alertTitle = '入力エラー';

	$: ({ id, discipline, level, event } = $page.params);
	$: isTournamentMode = data.isTournamentMode;
	$: isMultiJudge = data.isMultiJudge;
	$: isChief = data.isChief;
	$: guestIdentifier = $page.url.searchParams.get('guest');

	onMount(() => {
		currentBib = '';
		bibStore.set(null);
		// ヘッダー情報を設定
		if (data.sessionDetails) {
			currentSession.set(data.sessionDetails);
		}
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
			alertMessage = 'ゼッケン番号は1～999の範囲で入力してください';
			showAlert = true;
			return false;
		}
		bibStore.set(bib);
		return true;
	}

	function handleConfirm() {
		const bib = parseInt(currentBib, 10) || 0;
		if (bib < 1 || bib > 999) {
			alertMessage = 'ゼッケン番号は1～999の範囲で入力してください';
			showAlert = true;
			return;
		}
		bibStore.set(bib);

		// 複数検定員モードOFFの場合は、直接採点画面に遷移
		if (!isMultiJudge) {
			const guestParam = guestIdentifier ? `&guest=${guestIdentifier}&join=true` : '';
			goto(`/session/${id}/${discipline}/${level}/${event}/score?bib=${bib}${guestParam}`);
			return;
		}

		// 複数検定員モードONで主任検定員の場合は、採点指示を送信
		if (formElement) {
			formElement.requestSubmit();
		}
	}
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	isGuest={!!data.guestIdentifier}
	guestName={data.guestParticipant?.guest_name || null}
/>

<div class="container">
	<div class="instruction">ゼッケン番号を入力してください</div>

	<div class="numeric-display">{currentBib || '0'}</div>

	<form method="POST" action="{guestIdentifier ? `?guest=${guestIdentifier}&` : '?'}/setPrompt" use:enhance bind:this={formElement}>
		<input type="hidden" name="bib" value={currentBib} />
	</form>

	<NumericKeypad on:input={handleInput} on:clear={handleClear} on:confirm={handleConfirm} />
	{#if form?.error}
		<p class="error-message">{form.error}</p>
	{/if}

	<div class="nav-buttons">
		<NavButton on:click={() => {
			const guestParam = guestIdentifier ? `?guest=${guestIdentifier}&join=true` : '';
			goto(isTournamentMode ? `/session/${id}/tournament-events${guestParam}` : `/session/${id}/${discipline}/${level}${guestParam}`);
		}}>
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
	.scoring-description {
		font-size: 14px;
		color: var(--secondary-text);
		margin: 0;
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
	.error-message {
		color: #dc3545;
		margin-top: 1rem;
		font-size: 14px;
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
		.scoring-info {
			margin-bottom: 16px;
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
		.scoring-info {
			margin-bottom: 12px;
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
		.scoring-info {
			margin-bottom: 10px;
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
		.error-message {
			font-size: 16px;
		}
		.nav-buttons {
			margin-top: 40px;
		}
	}
</style>
