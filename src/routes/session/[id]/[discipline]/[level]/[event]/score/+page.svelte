<script lang="ts">
	import NumericKeypad from '$lib/components/NumericKeypad.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import { page } from '$app/stores';
	import { getContext, onMount, onDestroy } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { currentBib, userProfile, currentSession, currentDiscipline, currentLevel, currentEvent } from '$lib/stores';
	import { get } from 'svelte/store';

	export let data: PageData;

	// レイアウトから共有されたSupabaseクライアントを受け取る
	const supabase = getContext<SupabaseClient>('supabase');
	let realtimeChannel: any;
	let pollingInterval: any;
	let previousIsActive: boolean | null = null;
	let isPageMounted = true; // ページがマウントされているかを追跡

	let currentScore = '';
	let loading = false;

	// アラートダイアログの状態
	let showAlert = false;
	let alertMessage = '';
	let alertTitle = 'エラー';

	$: isChief = data.isChief;
	$: isMultiJudge = data.isMultiJudge;
	// 主任検定員または複数検定員モードOFFの場合にボタンを表示
	$: showBibEditButton = isChief || !isMultiJudge;

	// キーパッドから数字が入力されたときの処理
	function handleInput(event: CustomEvent<string>) {
		const num = event.detail;
		if (currentScore.length < 2) {
			currentScore = currentScore === '0' && num !== '0' ? num : currentScore + num;
		}
	}

	function handleClear() {
		currentScore = '';
	}

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
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}&join=true` : '';
		goto(`/session/${$page.params.id}/${$page.params.discipline}/${$page.params.level}/${$page.params.event}${guestParam}`);
	}

	async function handleConfirm() {
		const score = parseInt(currentScore, 10) || 0;
		if (score < 0 || score > 99) {
			alertTitle = '入力エラー';
			alertMessage = '得点は0～99の範囲で入力してください';
			showAlert = true;
			return;
		}

		loading = true;
		// URLからパラメータを取得
		const { id, discipline, level, event } = $page.params;

		const bib = $currentBib;
		const profile = get(userProfile);
		const sessionDetails = get(currentSession);

		if (!bib) {
			alertTitle = 'エラー';
			alertMessage = 'ゼッケン番号がありません。前のページに戻って再入力してください。';
			showAlert = true;
			loading = false;
			return;
		}

		const {
			data: { user }
		} = await supabase.auth.getUser();

		// ゲストユーザーの場合、名前を取得
		let judgeName = profile?.full_name || user?.email;
		const guestIdentifier = $page.url.searchParams.get('guest');

		if (!user && guestIdentifier) {
			const { data: guestData } = await supabase
				.from('session_participants')
				.select('guest_name')
				.eq('session_id', id)
				.eq('guest_identifier', guestIdentifier)
				.eq('is_guest', true)
				.single();

			if (guestData?.guest_name) {
				judgeName = guestData.guest_name;
			}
		}

		const { error } = await supabase.from('results').upsert(
			{
				session_id: id,
				bib: bib,
				score: score,
				judge_name: judgeName,
				discipline: discipline,
				level: level,
				event_name: event
			},
			{
				// このオプションが重要です。
				// どの列の組み合わせが重複しているかをデータベースに教えます。
				onConflict: 'session_id, bib, discipline, level, event_name, judge_name'
			}
		);

		if (error) {
			alertTitle = 'エラー';
			alertMessage = '得点の送信に失敗しました: ' + error.message;
			showAlert = true;
			loading = false;
		} else {
			const guestParam = guestIdentifier ? `&guest=${guestIdentifier}&join=true` : '';
			if (sessionDetails?.is_multi_judge) {
				goto(`/session/${id}/${discipline}/${level}/${event}/score/status?bib=${bib}${guestParam}`);
			} else {
				goto(
					`/session/${id}/${discipline}/${level}/${event}/score/complete?bib=${bib}&score=${score}${guestParam}`
				);
			}
		}
		loading = false;
	}

	// セッション終了を監視
	onMount(() => {
		const sessionId = $page.params.id;
		const { discipline, level, event } = $page.params;

		// ヘッダー情報を設定
		currentDiscipline.set(discipline);
		currentLevel.set(level);
		currentEvent.set(event);
		// currentBibは既にストアに設定されているはず

		console.log('[採点画面] リアルタイムリスナーをセットアップ中...', { sessionId });

		realtimeChannel = supabase
			.channel(`session-end-score-${sessionId}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'sessions',
					filter: `id=eq.${sessionId}`
				},
				async (payload) => {
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
				}
			)
			.subscribe((status) => {
				console.log('[採点画面] Realtimeチャンネルの状態:', status);
				if (status === 'SUBSCRIBED') {
					console.log('[採点画面] ✅ リアルタイム接続成功');

					// ポーリング追加
					pollingInterval = setInterval(async () => {
						// ページがアンマウントされていたらポーリングを停止
						if (!isPageMounted) {
							console.log('[採点画面/polling] ⚠️ ページがアンマウントされているため、ポーリングを停止します');
							if (pollingInterval) {
								clearInterval(pollingInterval);
							}
							return;
						}

						// 現在のパスをチェック - 採点画面から離れていたらポーリングを停止
						const currentPath = window.location.pathname;
						if (!currentPath.endsWith('/score')) {
							console.log('[採点画面/polling] ⚠️ 採点画面から離れているため、ポーリングを停止します。パス:', currentPath);
							if (pollingInterval) {
								clearInterval(pollingInterval);
							}
							return;
						}

						const { data: sessionData, error } = await supabase
							.from('sessions')
							.select('is_active, active_prompt_id')
							.eq('id', sessionId)
							.single();

						if (!error && sessionData) {
							const isActive = sessionData.is_active;
							const currentPromptId = sessionData.active_prompt_id;

							if (previousIsActive === null) {
								previousIsActive = isActive;
								return;
							}

							// セッション終了を先にチェック
							if (previousIsActive !== isActive && isActive === false && previousIsActive === true) {
								console.log('[採点画面] ✅ 検定終了を検知（ポーリング）');
								// 再度パスチェック - 採点画面にいる場合のみ遷移
								if (window.location.pathname.endsWith('/score')) {
									goto(`/session/${sessionId}?ended=true`);
								} else {
									console.log('[採点画面] ⚠️ 既に採点画面から離れているため、遷移をスキップ');
								}
								return;
							}

							// active_prompt_idがnullになった場合（一般検定員のみ、かつセッションがアクティブな場合）
							if (!isChief && isActive === true && currentPromptId === null) {
								console.log('[採点画面/一般検定員] ✅ ゼッケン修正を検知（ポーリング）');
								// 再度パスチェック - 採点画面にいる場合のみ遷移
								if (window.location.pathname.endsWith('/score')) {
									goto(`/session/${sessionId}`);
								} else {
									console.log('[採点画面] ⚠️ 既に採点画面から離れているため、遷移をスキップ');
								}
								return;
							}

							previousIsActive = isActive;
						}
					}, 3000);
				}
			});
	});

	onDestroy(() => {
		console.log('[採点画面] onDestroy実行 - ページを離れます');
		isPageMounted = false; // ページを離れたことを記録
		if (realtimeChannel) {
			supabase.removeChannel(realtimeChannel);
		}
		if (pollingInterval) {
			clearInterval(pollingInterval);
		}
	});

	// ゲスト情報を取得（URLから）
	$: guestIdentifier = $page.url.searchParams.get('guest');
</script>

<Header pageUser={data.user} isGuest={!!data.guestIdentifier} guestName={data.guestParticipant?.guest_name || null} />

<div class="container">
	<div class="instruction">得点を入力してください</div>

	<div class="numeric-display">{currentScore || '0'}</div>

	<NumericKeypad on:input={handleInput} on:clear={handleClear} on:confirm={handleConfirm} disabled={loading} />

	{#if loading}
		<div class="loading-overlay">
			<LoadingSpinner size="large" />
			<p class="loading-text">送信中...</p>
		</div>
	{/if}

	{#if showBibEditButton}
		<div class="nav-buttons">
			<NavButton on:click={handleEditBib}>ゼッケン番号入力に戻る</NavButton>
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
		.nav-buttons {
			margin-top: 40px;
		}
	}
</style>
