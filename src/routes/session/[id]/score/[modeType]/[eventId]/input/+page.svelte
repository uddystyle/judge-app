<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import ScoreInput from '$lib/components/ScoreInput.svelte';
	import Header from '$lib/components/Header.svelte';
	import SyncStatusBadge from '$lib/components/SyncStatusBadge.svelte';
	import IosInstallHint from '$lib/components/IosInstallHint.svelte';
	import { page } from '$app/stores';
	import { goto, replaceState } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { currentSession, currentDiscipline, currentEvent, currentBib } from '$lib/stores';
	import { onMount, onDestroy } from 'svelte';
	import {
		enqueueScoreMutation,
		markMutationSynced,
		removeMutation
	} from '$lib/offline/scoreQueue';
	import { startOfflineSync, pendingCount, isOffline } from '$lib/offline/syncStatus';
	import { refreshSessionCache, type CachedParticipant } from '$lib/offline/sessionCache';
	import { isPermanentActionFailureStatus } from '$lib/syncContract';
	import OfflineNextBibForm from '$lib/components/OfflineNextBibForm.svelte';
	import * as m from '$lib/paraglide/messages.js';

	export let data: PageData;
	export let form: ActionData;

	$: sessionId = $page.params.id;
	$: modeType = $page.params.modeType;
	$: eventId = $page.params.eventId;
	$: sessionName = data.sessionDetails.name;
	$: eventName = data.isTrainingMode ? data.eventInfo.name : data.eventInfo.event_name;
	// オフライン中の「次の選手」継続時は load 由来の値をローカルで上書きする
	let overrideBibNumber: number | null = null;
	let overrideParticipantId: number | null = null;
	$: bibNumber = overrideBibNumber ?? data.bibNumber;
	$: participantId = overrideParticipantId ?? data.participantId;
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

	// キューが空になった（自動同期が送信し終えた）ら「保存済み・同期待ち」表示を下ろす。
	// ただし「次の選手」フォームの入力途中は消さない（旧ゼッケンへの誤採点を防ぐ）
	$: if (offlineSaved && !$isOffline && $pendingCount === 0 && !nextBibFormOpen) {
		offlineSaved = false;
	}

	// オフライン中の「次の選手」継続（単独審判の研修のみ。大会は常に多審制のため対象外）。
	// 同期 API は未登録ゼッケンを participant_not_found で恒久拒否するため、
	// requireRegistered でキャッシュ済み参加者のみ許可する
	let scoreResetKey = 0;
	let nextBibFormOpen = false;
	function handleNextBib(
		event: CustomEvent<{ bib: number; participant: CachedParticipant | null }>
	) {
		const participant = event.detail.participant;
		if (!participant) return;
		overrideBibNumber = event.detail.bib;
		overrideParticipantId = participant.id;
		currentBib.set(event.detail.bib);
		// URL の ?bib=/?participantId= も新しい選手に揃える（shallow routing）。
		// リロード・タブ復元時に load が旧選手を復元して誤採点になるのを防ぐ
		try {
			const url = new URL($page.url);
			url.searchParams.set('bib', String(event.detail.bib));
			url.searchParams.set('participantId', String(participant.id));
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- 現在 URL のクエリのみ書き換え（ルート解決不要）
			replaceState(url, {});
		} catch {
			// replaceState 不可（初期化前等）でも継続採点自体は成立する
		}
		offlineSaved = false;
		scoreResetKey += 1;
	}

	// ヘッダー情報を設定
	onMount(() => {
		currentSession.set({ name: sessionName });
		currentDiscipline.set(data.isTrainingMode ? m.mode_training() : m.mode_tournament());
		currentEvent.set(eventName);
		currentBib.set(bibNumber);
		stopOfflineSync = startOfflineSync();
		// オフライン継続用にセッションデータを事前ダウンロード（失敗しても採点は阻害しない）
		void refreshSessionCache(Number.parseInt(sessionId ?? '', 10), {
			guestIdentifier: guestIdentifier ?? null
		});
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
	<div class="offline-saved-message">
		端末に保存済みです。通信が復帰すると自動同期されます。
		{#if !data.isMultiJudge}
			<OfflineNextBibForm
				sessionId={Number.parseInt(sessionId ?? '', 10)}
				requireRegistered
				bind:open={nextBibFormOpen}
				on:confirm={handleNextBib}
			/>
		{/if}
	</div>
{/if}

{#if form?.error}
	<div class="error-message">{form.error}</div>
{/if}

{#key scoreResetKey}
	<ScoreInput
		{minScore}
		{maxScore}
		maxDigits={3}
		{loading}
		{showBackButton}
		on:submit={handleSubmit}
		on:back={handleBackToBib}
	/>
{/key}

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
					if (isPermanentActionFailureStatus(result.status) && overrideBibNumber === null) {
						// サーバーが検証拒否: 再送しても同じ拒否のためキューから除去し、従来どおりエラー表示
						await removeMutation(queuedId).catch(() => {});
					}
					// 401/408/429/5xx は一時的失敗: キューに保持し自動同期の再送に委ねる。
					// 継続採点中（override 有効）の 4xx も保持する: キャッシュ由来の participantId が
					// 古いだけで、bib で解決する同期 API なら正しく適用できる可能性があるため
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
