<script lang="ts">
	import ScoreInput from '$lib/components/ScoreInput.svelte';
	import Header from '$lib/components/Header.svelte';
	import SyncStatusBadge from '$lib/components/SyncStatusBadge.svelte';
	import IosInstallHint from '$lib/components/IosInstallHint.svelte';
	import {
		enqueueScoreMutation,
		markMutationSynced,
		removeMutation,
		setCurrentSyncIdentity
	} from '$lib/offline/scoreQueue';
	import { startOfflineSync, pendingCount, isOffline } from '$lib/offline/syncStatus';
	import { refreshSessionCache } from '$lib/offline/sessionCache';
	import { isPermanentActionFailureStatus } from '$lib/syncContract';
	import OfflineNextBibForm from '$lib/components/OfflineNextBibForm.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { page } from '$app/stores';
	import { getContext, onMount, onDestroy } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { createSessionMonitorWithPolling, type RealtimeChannelHandle } from '$lib/realtime';
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import {
		currentBib,
		userProfile,
		currentSession,
		currentDiscipline,
		currentLevel,
		currentEvent
	} from '$lib/stores';
	import { get } from 'svelte/store';
	import { applyAction, deserialize } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';

	export let data: PageData;

	// レイアウトから共有されたSupabaseクライアントを受け取る
	const supabase = getContext<SupabaseClient>('supabase');
	let sessionMonitorHandle: RealtimeChannelHandle | null = null;
	let previousIsActive: boolean | null = null;
	let previousActivePromptId: string | number | null = data.activePromptId ?? null;
	let isPageMounted = true; // ページがマウントされているかを追跡
	let navigationStarted = false;

	function navigateFromMonitor(url: string) {
		if (!isPageMounted || navigationStarted) return;
		navigationStarted = true;
		goto(url);
	}

	let loading = false;

	// オフライン採点: 送信前に端末へ保存し、通信失敗時はキューに残して自動同期する
	let offlineSaved = false;
	let stopOfflineSync: (() => void) | null = null;

	// キューが空になった（自動同期が送信し終えた）ら「保存済み・同期待ち」表示を下ろす。
	// ただし「次の選手」フォームの入力途中は消さない（旧ゼッケンへの誤採点を防ぐ）
	$: if (offlineSaved && !$isOffline && $pendingCount === 0 && !nextBibFormOpen) {
		offlineSaved = false;
	}

	// オフライン中の「次の選手」継続（単独検定員のみ。検定は未知ゼッケンも同期側で自動作成される）
	let scoreResetKey = 0;
	let nextBibFormOpen = false;
	function handleNextBib(event: CustomEvent<{ bib: number }>) {
		currentBib.set(event.detail.bib);
		offlineSaved = false;
		scoreResetKey += 1;
	}

	$: isChief = data.isChief;
	$: isMultiJudge = data.isMultiJudge;
	// 主任検定員または複数検定員モードOFFの場合にボタンを表示
	$: showBibEditButton = isChief || !isMultiJudge;

	// ゼッケン番号を修正する際の処理
	async function handleEditBib() {
		const sessionId = $page.params.id;

		// 複数検定員モードの場合のみ、active_prompt_idをクリア（一般検定員を準備画面に戻す）
		if (isMultiJudge) {
			const { error } = await supabase
				.from('sessions')
				.update({ active_prompt_id: null })
				.eq('id', sessionId);

			if (error) {
				console.error('Failed to clear active_prompt_id:', error);
				alert('エラーが発生しました。');
				return;
			}
		}

		// ゼッケン入力画面に遷移
		const guestIdentifier = $page.url.searchParams.get('guest');
		goto(
			`/session/${$page.params.id}/${$page.params.discipline}/${$page.params.level}/${$page.params.event}`
		);
	}

	async function handleSubmit(event: CustomEvent<{ score: number }>) {
		const score = event.detail.score;

		loading = true;
		// URLからパラメータを取得
		const { id, discipline, level, event: eventParam } = $page.params;

		// 複数検定員は active_prompt 由来の権威 bib を優先（揮発ストアの null/stale を避ける）。
		// 単独検定員は従来どおりストア（主任が手動選択した bib）。
		const bib = data.isMultiJudge ? (data.activeBib ?? $currentBib) : $currentBib;

		if (!bib) {
			loading = false;
			return;
		}

		const guestIdentifier = $page.url.searchParams.get('guest');
		offlineSaved = false;

		// 1. まず端末に保存（=「端末保存済み」。POST が失敗しても採点は失われない）
		let pendingMutationId: string | null = null;
		try {
			const queued = await enqueueScoreMutation({
				session_id: Number.parseInt(id ?? '', 10),
				mode_type: 'certification',
				discipline: discipline ?? null,
				level: level ?? null,
				event_name: eventParam ?? null,
				bib_number: Number(bib),
				score,
				// owner は URL の ?guest= ではなく JWT 検証済みの identity を積む。
				// ?guest= は通常フローで URL から除去され null になるため、これを使うと
				// 同期時の owner ガードが正当なゲスト採点を誤って弾く（データ損失）。
				judge_id: data.guestParticipant ? null : (data.user?.id ?? null),
				guest_identifier: data.guestParticipant?.guest_identifier ?? null
			});
			pendingMutationId = queued.client_mutation_id;
		} catch (err) {
			// IndexedDB 不可（プライベートブラウズ等）でも従来どおりオンライン送信は続行
			console.error('[offline] 端末保存に失敗:', err);
		}

		// 2. サーバーアクションを呼び出す
		const formData = new FormData();
		formData.append('score', score.toString());
		formData.append('bib', bib.toString());
		if (pendingMutationId) {
			// IndexedDB の mutation とオンライン action を同じ冪等キーで結び付ける。
			formData.append('client_mutation_id', pendingMutationId);
		}

		try {
			const response = await fetch(`?/submitScore${guestIdentifier ? `` : ''}`, {
				method: 'POST',
				body: formData
			});

			const result: ActionResult = deserialize(await response.text());

			if (result.type === 'failure') {
				console.error('Failed to submit score:', result.data?.error);
				if (pendingMutationId && isPermanentActionFailureStatus(result.status)) {
					// サーバーが検証拒否: 再送しても同じ拒否のためキューから除去し、従来どおりエラー表示
					await removeMutation(pendingMutationId).catch(() => {});
				}
				// 401/408/429/5xx は一時的失敗: キューに保持し自動同期の再送に委ねる
				alert(result.data?.error || '採点の保存に失敗しました。');
				loading = false;
			} else if (result.type === 'success' || result.type === 'redirect') {
				// サーバー保存成功: キュー側は synced 扱い（同期 API へは送らない）
				if (pendingMutationId) await markMutationSynced(pendingMutationId).catch(() => {});
				if (isMultiJudge) {
					goto(`/session/${id}/${discipline}/${level}/${eventParam}/score/status?bib=${bib}`);
				} else {
					goto(
						`/session/${id}/${discipline}/${level}/${eventParam}/score/complete?bib=${bib}&score=${score}`
					);
				}
			} else {
				// 'error' 等: action 内の例外。キューに保持して自動同期に委ね、画面は操作可能に戻す
				console.error('Score action returned error result:', result);
				if (pendingMutationId) {
					offlineSaved = true;
				} else {
					alert('採点の送信中にエラーが発生しました。');
				}
				loading = false;
			}
		} catch (error) {
			// ネットワーク到達失敗: キューに保持（自動同期が復帰後に送る）
			console.error('Error submitting score (offline?):', error);
			if (pendingMutationId) {
				offlineSaved = true;
			} else {
				alert('採点の送信中にエラーが発生しました。');
			}
			loading = false;
		}
	}

	// セッション終了を監視
	onMount(() => {
		setCurrentSyncIdentity(
			data.guestParticipant?.guest_identifier
				? {
						owner_type: 'guest',
						judge_id: null,
						guest_identifier: data.guestParticipant.guest_identifier
					}
				: data.user?.id
					? { owner_type: 'auth', judge_id: data.user.id, guest_identifier: null }
					: null
		);
		stopOfflineSync = startOfflineSync();
		// オフライン継続用にセッションデータを事前ダウンロード（失敗しても採点は阻害しない）
		void refreshSessionCache(Number.parseInt($page.params.id ?? '', 10), {
			guestIdentifier: $page.url.searchParams.get('guest')
		});
		// このルート（/session/[id]/...）では params.id は必ず存在する
		const sessionId = $page.params.id!;
		const { discipline, level, event } = $page.params;

		// ヘッダー情報を設定
		if (data.sessionDetails) {
			currentSession.set(data.sessionDetails);
		}
		currentDiscipline.set(discipline ?? null);
		currentLevel.set(level ?? null);
		currentEvent.set(event ?? null);
		// 複数検定員: 表示と送信を確実に一致させるため、active_prompt 由来の権威 bib をストアへ同期。
		// （ナビ時に currentBib が未設定でも、ここで現在の滑走者の bib に揃う）
		if (data.isMultiJudge && data.activeBib != null) {
			currentBib.set(data.activeBib);
		}

		console.log('[採点画面] リアルタイムリスナーをセットアップ中...', { sessionId });

		// complete ページと同方針の共通ヘルパー:
		// realtime（バックオフ再購読つき）+ 10秒ポーリングの保険で sessions を監視
		sessionMonitorHandle = createSessionMonitorWithPolling(supabase, {
			sessionId,
			channelPrefix: 'session-end-score',
			pollingIntervalMs: 10000,
			onRealtimePayload: (payload) => {
				if (!isPageMounted || navigationStarted) return;
				console.log('[採点画面] セッション更新を検知:', payload);
				const isActive = payload.new.is_active;
				const newPromptId = payload.new.active_prompt_id;
				const oldPromptId = previousActivePromptId;
				previousActivePromptId = newPromptId;
				console.log('[採点画面] is_active:', isActive);
				console.log('[採点画面] active_prompt_id:', { old: oldPromptId, new: newPromptId });

				// セッションが終了した場合、待機画面（終了画面）に遷移
				// この処理を先に行うことで、終了時にactive_prompt_idがクリアされても終了画面に遷移する
				if (isActive === false) {
					console.log('[採点画面] 検定/大会終了を検知。終了画面に遷移します。');
					navigateFromMonitor(`/session/${sessionId}?ended=true`);
					return;
				}

				// 主任検定員がゼッケン入力を修正した場合（active_prompt_idがクリアされた）
				// 一般検定員を準備画面に戻す
				// セッションがアクティブな場合のみ実行
				if (!isChief && isActive === true && oldPromptId !== null && newPromptId === null) {
					console.log('[採点画面/一般検定員] ゼッケン修正を検知。準備画面に戻ります。');
					navigateFromMonitor(`/session/${sessionId}`);
					return;
				}
			},
			onPollingData: (sessionData) => {
				// ページを離れている間はポーリング結果で遷移しない
				if (!isPageMounted || navigationStarted || !window.location.pathname.endsWith('/score')) {
					return;
				}

				const isActive = sessionData.is_active;
				const currentPromptId = sessionData.active_prompt_id;

				if (previousIsActive === null) {
					previousIsActive = isActive;
					previousActivePromptId = currentPromptId;
					return;
				}

				// セッション終了を先にチェック
				if (previousIsActive !== isActive && isActive === false && previousIsActive === true) {
					console.log('[採点画面] ✅ 検定終了を検知（ポーリング）');
					navigateFromMonitor(`/session/${sessionId}?ended=true`);
					return;
				}

				// active_prompt_idがnullになった場合（一般検定員のみ、かつセッションがアクティブな場合）
				if (
					!isChief &&
					isActive === true &&
					previousActivePromptId !== null &&
					currentPromptId === null
				) {
					console.log('[採点画面/一般検定員] ✅ ゼッケン修正を検知（ポーリング）');
					navigateFromMonitor(`/session/${sessionId}`);
					return;
				}

				previousIsActive = isActive;
				previousActivePromptId = currentPromptId;
			},
			onError: () => {
				// 再購読を使い果たしてもポーリング監視は継続するため、reload はしない
				console.error('[採点画面] ❌ Realtime再接続を断念 - ポーリング監視を継続します');
			}
		});
	});

	onDestroy(() => {
		console.log('[採点画面] onDestroy実行 - ページを離れます');
		isPageMounted = false; // ページを離れたことを記録
		sessionMonitorHandle?.cleanup();
		stopOfflineSync?.();
	});

	// ゲスト情報を取得（URLから）
	$: guestIdentifier = $page.url.searchParams.get('guest');
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
		{#if !isMultiJudge}
			<OfflineNextBibForm
				sessionId={Number.parseInt($page.params.id ?? '', 10)}
				bind:open={nextBibFormOpen}
				on:confirm={handleNextBib}
			/>
		{/if}
	</div>
{/if}

{#key scoreResetKey}
	<ScoreInput
		minScore={0}
		maxScore={99}
		maxDigits={2}
		{loading}
		showBackButton={showBibEditButton}
		on:submit={handleSubmit}
		on:back={handleEditBib}
	/>
{/key}

<IosInstallHint />

<style>
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
