<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import ScoreInput from '$lib/components/ScoreInput.svelte';
	import Header from '$lib/components/Header.svelte';
	import SyncStatusBadge from '$lib/components/SyncStatusBadge.svelte';
	import IosInstallHint from '$lib/components/IosInstallHint.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { currentSession, currentDiscipline, currentEvent, currentBib } from '$lib/stores';
	import { onMount, onDestroy } from 'svelte';
	import {
		enqueueScoreMutation,
		markMutationSynced,
		removeMutation
	} from '$lib/offline/scoreQueue';
	import { startOfflineSync, pendingCount, isOffline } from '$lib/offline/syncStatus';
	import { isPermanentActionFailureStatus } from '$lib/syncContract';
	import * as m from '$lib/paraglide/messages.js';

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
	$: formAction = guestIdentifier ? `?/submitScore` : '?/submitScore';
	$: showBackButton = !data.isMultiJudge || data.isChief;

	let loading = false;
	let scoreInput: HTMLInputElement;

	// オフライン採点: 送信前に端末へ保存し、通信失敗時はキューに残して自動同期する
	// （network-resilience-strategy.md Phase 1-3。送信結果との整合は enhance コールバックで取る）
	let pendingMutationId: string | null = null;
	let offlineSaved = false;
	let stopOfflineSync: (() => void) | null = null;

	// キューが空になった（自動同期が送信し終えた）ら「保存済み・同期待ち」表示を下ろす
	$: if (offlineSaved && !$isOffline && $pendingCount === 0) {
		offlineSaved = false;
	}

	// ヘッダー情報を設定
	onMount(() => {
		currentSession.set({ name: sessionName });
		currentDiscipline.set(data.isTrainingMode ? m.mode_training() : m.mode_tournament());
		currentEvent.set(eventName);
		currentBib.set(bibNumber);
		stopOfflineSync = startOfflineSync();
	});

	onDestroy(() => {
		stopOfflineSync?.();
	});

	// ScoreInputコンポーネントからのsubmitイベントを処理
	async function handleSubmit(event: CustomEvent<{ score: number }>) {
		loading = true;
		offlineSaved = false;

		// 1. まず端末に保存（=「端末保存済み」。POST が失敗しても採点は失われない）
		try {
			const queued = await enqueueScoreMutation({
				session_id: Number.parseInt(sessionId ?? '', 10),
				mode_type: modeType === 'training' ? 'training' : 'tournament',
				event_id: Number.parseInt(eventId ?? '', 10),
				bib_number: bibNumber,
				score: event.detail.score,
				guest_identifier: guestIdentifier ?? null
			});
			pendingMutationId = queued.client_mutation_id;
		} catch (err) {
			// IndexedDB 不可（プライベートブラウズ等）でも従来どおりオンライン送信は続行
			console.error('[offline] 端末保存に失敗:', err);
			pendingMutationId = null;
		}

		// 2. hidden inputの値を直接設定してフォームを送信
		if (scoreInput) {
			scoreInput.value = event.detail.score.toString();
		}
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
			goto(
				`/session/${sessionId}/score/${modeType}/${eventId}/complete?bib=${form.bibNumber}&score=${form.score}`
			);
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

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	isGuest={!!data.guestIdentifier}
	guestName={data.guestParticipant?.guest_name || null}
/>

<SyncStatusBadge />

{#if offlineSaved}
	<div class="offline-saved-message">端末に保存済みです。通信が復帰すると自動同期されます。</div>
{/if}

{#if form?.error}
	<div class="error-message">{form.error}</div>
{/if}

<ScoreInput
	{minScore}
	{maxScore}
	maxDigits={3}
	{loading}
	{showBackButton}
	on:submit={handleSubmit}
	on:back={handleBackToBib}
/>

<IosInstallHint />

<form
	id="scoreForm"
	method="POST"
	action={formAction}
	use:enhance={() => {
		// 送信完了後に loading を必ず解除する。
		// これがないと失敗時 (fail) にキーパッド/確定ボタンが disabled のまま固まり、再入力できなくなる。
		return async ({ result, update }) => {
			// オフラインキューとの整合（enqueue 済みの mutation を送信結果で確定させる）
			const queuedId = pendingMutationId;
			pendingMutationId = null;
			if (queuedId) {
				if (result.type === 'success' || result.type === 'redirect') {
					// サーバー保存成功: キュー側は synced 扱い（同期 API へは送らない）
					await markMutationSynced(queuedId).catch(() => {});
				} else if (result.type === 'failure') {
					if (isPermanentActionFailureStatus(result.status)) {
						// サーバーが検証拒否: 再送しても同じ拒否のためキューから除去し、従来どおりエラー表示
						await removeMutation(queuedId).catch(() => {});
					}
					// 401/408/429/5xx は一時的失敗: キューに保持し自動同期の再送に委ねる
				} else if (result.type === 'error') {
					// ネットワーク到達失敗: キューに保持し、採点画面に留まって「保存済み」を見せる。
					// update() は error result を +error ページに置き換えてしまうため呼ばない
					offlineSaved = true;
					loading = false;
					return;
				}
			}
			await update({ reset: false });
			loading = false;
		};
	}}
	style="display: none;"
>
	<input type="hidden" name="score" bind:this={scoreInput} />
	<input type="hidden" name="participantId" value={participantId} />
	<input type="hidden" name="bibNumber" value={bibNumber} />
</form>

<style>
	.error-message {
		background: var(--color-error-tint);
		border: 1px solid var(--color-error);
		color: var(--color-error);
		padding: 12px;
		border-radius: 8px;
		margin: 20px;
		text-align: center;
	}
	.offline-saved-message {
		background: var(--color-success-tint);
		border: 1px solid var(--color-success);
		color: var(--color-success);
		padding: 12px;
		border-radius: 8px;
		margin: 20px;
		text-align: center;
	}
</style>
