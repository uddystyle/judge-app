<script lang="ts">
	import ScoreInput from '$lib/components/ScoreInput.svelte';
	import Header from '$lib/components/Header.svelte';
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
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}&join=true` : '';
		goto(`/session/${$page.params.id}/${$page.params.discipline}/${$page.params.level}/${$page.params.event}${guestParam}`);
	}

	async function handleSubmit(event: CustomEvent<{ score: number }>) {
		const score = event.detail.score;

		loading = true;
		// URLからパラメータを取得
		const { id, discipline, level, event: eventParam } = $page.params;

		const bib = $currentBib;
		const profile = get(userProfile);
		const sessionDetails = get(currentSession);

		if (!bib) {
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
				event_name: eventParam
			},
			{
				// このオプションが重要です。
				// どの列の組み合わせが重複しているかをデータベースに教えます。
				onConflict: 'session_id, bib, discipline, level, event_name, judge_name'
			}
		);

		if (error) {
			console.error('Failed to submit score:', error);
			loading = false;
		} else {
			const guestParam = guestIdentifier ? `&guest=${guestIdentifier}&join=true` : '';
			if (sessionDetails?.is_multi_judge) {
				goto(`/session/${id}/${discipline}/${level}/${eventParam}/score/status?bib=${bib}${guestParam}`);
			} else {
				goto(
					`/session/${id}/${discipline}/${level}/${eventParam}/score/complete?bib=${bib}&score=${score}${guestParam}`
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

<ScoreInput
	minScore={0}
	maxScore={99}
	maxDigits={2}
	loading={loading}
	showBackButton={showBibEditButton}
	on:submit={handleSubmit}
	on:back={handleEditBib}
/>
