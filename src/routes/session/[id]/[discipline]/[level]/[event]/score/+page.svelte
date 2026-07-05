<script lang="ts">
	import ScoreInput from '$lib/components/ScoreInput.svelte';
	import Header from '$lib/components/Header.svelte';
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
	let isPageMounted = true; // ページがマウントされているかを追跡

	let loading = false;

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
				alertMessage = 'エラーが発生しました。';
				showAlert = true;
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

		// サーバーアクションを呼び出す
		const formData = new FormData();
		formData.append('score', score.toString());
		formData.append('bib', bib.toString());

		try {
			const response = await fetch(`?/submitScore${guestIdentifier ? `` : ''}`, {
				method: 'POST',
				body: formData
			});

			const result: ActionResult = deserialize(await response.text());

			if (result.type === 'failure') {
				console.error('Failed to submit score:', result.data?.error);
				// エラーメッセージを表示する場合はここで処理
				alert(result.data?.error || '採点の保存に失敗しました。');
				loading = false;
			} else if (result.type === 'success') {
				if (isMultiJudge) {
					goto(`/session/${id}/${discipline}/${level}/${eventParam}/score/status?bib=${bib}`);
				} else {
					goto(
						`/session/${id}/${discipline}/${level}/${eventParam}/score/complete?bib=${bib}&score=${score}`
					);
				}
			}
		} catch (error) {
			console.error('Error submitting score:', error);
			alert('採点の送信中にエラーが発生しました。');
			loading = false;
		}
	}

	// セッション終了を監視
	onMount(() => {
		// このルート（/session/[id]/...）では params.id は必ず存在する
		const sessionId = $page.params.id!;
		const { discipline, level, event } = $page.params;

		// ヘッダー情報を設定
		if (data.sessionDetails) {
			currentSession.set(data.sessionDetails);
		}
		currentDiscipline.set(discipline);
		currentLevel.set(level);
		currentEvent.set(event);
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
				console.log('[採点画面] セッション更新を検知:', payload);
				const isActive = payload.new.is_active;
				const newPromptId = payload.new.active_prompt_id;
				const oldPromptId = payload.old.active_prompt_id;
				console.log('[採点画面] is_active:', isActive);
				console.log('[採点画面] active_prompt_id:', { old: oldPromptId, new: newPromptId });

				// セッションが終了した場合、待機画面（終了画面）に遷移
				// この処理を先に行うことで、終了時にactive_prompt_idがクリアされても終了画面に遷移する
				if (isActive === false) {
					console.log('[採点画面] 検定/大会終了を検知。終了画面に遷移します。');
					goto(`/session/${sessionId}?ended=true`);
					return;
				}

				// 主任検定員がゼッケン入力を修正した場合（active_prompt_idがクリアされた）
				// 一般検定員を準備画面に戻す
				// セッションがアクティブな場合のみ実行
				if (!isChief && isActive === true && oldPromptId !== null && newPromptId === null) {
					console.log('[採点画面/一般検定員] ゼッケン修正を検知。準備画面に戻ります。');
					goto(`/session/${sessionId}`);
					return;
				}
			},
			onPollingData: (sessionData) => {
				// ページを離れている間はポーリング結果で遷移しない
				if (!isPageMounted || !window.location.pathname.endsWith('/score')) {
					return;
				}

				const isActive = sessionData.is_active;
				const currentPromptId = sessionData.active_prompt_id;

				if (previousIsActive === null) {
					previousIsActive = isActive;
					return;
				}

				// セッション終了を先にチェック
				if (previousIsActive !== isActive && isActive === false && previousIsActive === true) {
					console.log('[採点画面] ✅ 検定終了を検知（ポーリング）');
					goto(`/session/${sessionId}?ended=true`);
					return;
				}

				// active_prompt_idがnullになった場合（一般検定員のみ、かつセッションがアクティブな場合）
				if (!isChief && isActive === true && currentPromptId === null) {
					console.log('[採点画面/一般検定員] ✅ ゼッケン修正を検知（ポーリング）');
					goto(`/session/${sessionId}`);
					return;
				}

				previousIsActive = isActive;
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

<ScoreInput
	minScore={0}
	maxScore={99}
	maxDigits={2}
	{loading}
	showBackButton={showBibEditButton}
	on:submit={handleSubmit}
	on:back={handleEditBib}
/>
