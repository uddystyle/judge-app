<script lang="ts">
	import { currentSession, currentBib } from '$lib/stores';
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { supabase } from '$lib/supabaseClient';

	// サーバーから渡されたデータを受け取る
	export let data: PageData;
	let realtimeChannel: any;
	let isSessionEnded = false;

	// このページが表示されたら、グローバルなストアを更新する
	onMount(async () => {
		currentSession.set(data.sessionDetails);

		// デバッグ: セッション情報を確認
		console.log('[DEBUG] セッション情報:', data.sessionDetails);
		console.log('[DEBUG] isChief:', data.isChief);

		// デバッグ: セッションを読み取れるか確認
		const { data: sessionTest, error: sessionError } = await supabase
			.from('sessions')
			.select('*')
			.eq('id', data.sessionDetails.id)
			.single();
		console.log('[DEBUG] セッション読み取りテスト:', { sessionTest, sessionError });

		if (!data.isChief) {
			const sessionId = data.sessionDetails.id;
			console.log('[一般検定員] リアルタイムリスナーをセットアップ中...', { sessionId });

			// 'sessions'テーブルの、このセッションIDの行に対するUPDATEのみを監視
			realtimeChannel = supabase
				.channel(`session-updates-${sessionId}`)
				.on(
					'postgres_changes',
					{
						event: 'UPDATE',
						schema: 'public',
						table: 'sessions',
						filter: `id=eq.${sessionId}`
					},
					async (payload) => {
						console.log('[一般検定員] セッション更新を検知:', payload);
						const newPromptId = payload.new.active_prompt_id;
						const isActive = payload.new.is_active;
						console.log('[一般検定員] is_active:', isActive);

						// セッションが終了した場合、検定終了画面を表示
						if (isActive === false) {
							console.log('[一般検定員] 検定終了を検知。検定終了画面を表示します。');
							isSessionEnded = true;
							return;
						}

						// 新しい採点指示IDがセットされたら
						if (newPromptId) {
							console.log('[一般検定員] 新しい採点指示を検知:', newPromptId);
							// 新しい指示の詳細をscoring_promptsテーブルから取得
							const { data: promptData, error } = await supabase
								.from('scoring_prompts')
								.select('*')
								.eq('id', newPromptId)
								.single();

							if (error) {
								console.error('[一般検定員] ❌ 採点指示の取得に失敗:', error);
								return;
							}

							console.log('[一般検定員] 採点指示データ取得成功:', promptData);

							if (promptData) {
								// ストアにゼッケン番号を保存
								currentBib.set(promptData.bib_number);
								console.log('[一般検定員] 採点画面に遷移します:', {
									sessionId,
									discipline: promptData.discipline,
									level: promptData.level,
									event: promptData.event_name
								});
								// 採点画面へ移動
								goto(
									`/session/${sessionId}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score`
								);
							}
						}
					}
				)
				.subscribe((status) => {
					console.log('[一般検定員] Realtimeチャンネルの状態:', status);
					if (status === 'SUBSCRIBED') {
						console.log('[一般検定員] ✅ リアルタイム接続成功');
					} else if (status === 'CHANNEL_ERROR') {
						console.error('[一般検定員] ❌ チャンネルエラー - 再接続を試みます');
						// 再接続
						setTimeout(() => {
							if (realtimeChannel) {
								supabase.removeChannel(realtimeChannel);
							}
							window.location.reload();
						}, 2000);
					} else if (status === 'TIMED_OUT') {
						console.error('[一般検定員] ❌ タイムアウト - 再接続を試みます');
						// 再接続
						setTimeout(() => {
							if (realtimeChannel) {
								supabase.removeChannel(realtimeChannel);
							}
							window.location.reload();
						}, 2000);
					} else if (status === 'CLOSED') {
						console.log('[一般検定員] リアルタイム接続が閉じられました');
					}
				});
		}
	});

	onDestroy(() => {
		if (realtimeChannel) {
			supabase.removeChannel(realtimeChannel);
		}
	});

	function selectDiscipline(discipline: string) {
		// 次のステップ（級選択）のページへ移動
		goto(`/session/${data.sessionDetails.id}/${discipline}`);
	}
</script>

<Header />

<div class="container">
	{#if data.isChief}
		<div class="instruction">種別を選択してください</div>
		<div class="list-keypad">
			{#each data.disciplines as discipline}
				<NavButton on:click={() => selectDiscipline(discipline)}>
					{discipline}
				</NavButton>
			{/each}
		</div>
	{:else}
		{#if isSessionEnded}
			<div class="instruction">検定終了</div>
			<div class="end-message">
				<p>この検定は終了しました。</p>
			</div>
		{:else}
			<div class="instruction">準備中…</div>
			<div class="wait-message">
				<p>主任検定員が採点の準備をしています。</p>
				<p>しばらくお待ちください。</p>
			</div>
			<div class="loading"></div>
		{/if}
	{/if}
	<div class="nav-buttons">
		<NavButton on:click={() => goto('/dashboard')}>検定選択に戻る</NavButton>
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
		margin-bottom: 28px;
	}
	.list-keypad {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.wait-message {
		margin: 24px 0;
		color: var(--secondary-text);
		line-height: 1.6;
	}
	.end-message {
		margin: 24px 0;
		padding: 20px;
		background: #f8f9fa;
		border-radius: 12px;
		border: 1px solid var(--separator-gray);
		color: var(--primary-text);
		line-height: 1.6;
		font-size: 16px;
	}
	.loading {
		display: inline-block;
		width: 20px;
		height: 20px;
		border: 2px solid rgba(0, 0, 0, 0.1);
		border-top-color: var(--primary-text);
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-top: 20px;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
