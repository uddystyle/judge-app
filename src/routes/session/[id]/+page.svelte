<script lang="ts">
	import { currentSession, currentBib, currentDiscipline, currentLevel, currentEvent } from '$lib/stores';
	import type { PageData, ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { supabase } from '$lib/supabaseClient';
	import { enhance } from '$app/forms';

	// サーバーから渡されたデータを受け取る
	export let data: PageData;
	export const form: ActionData = undefined;
	let realtimeChannel: any;
	let pollingInterval: any;
	let previousStatus: string | null = null; // ポーリングで前回の状態を記憶
	// URLパラメータで終了フラグをチェック
	let isSessionEnded = false;

	// 研修モード用の変数
	let selectedUserId: string = '';

	// デバッグ: isSessionEndedの変更を監視
	$: {
		console.log('[DEBUG] isSessionEnded changed:', isSessionEnded);
	}

	// このページが表示されたら、グローバルなストアを更新する
	onMount(async () => {
		currentSession.set(data.sessionDetails);

		// セッション選択画面に戻ったので、種目情報をクリア
		currentDiscipline.set(null);
		currentLevel.set(null);
		currentEvent.set(null);
		currentBib.set(null);

		// URLパラメータで終了フラグをチェック
		const urlParams = new URLSearchParams(window.location.search);
		const hasEndedParam = urlParams.get('ended') === 'true';

		if (hasEndedParam) {
			console.log('[DEBUG] URLパラメータで終了フラグを検知（リアルタイム終了）');
			isSessionEnded = true;
		} else {
			isSessionEnded = false;
		}
		// 注: セッションが終了していても（is_active: false）、ダッシュボードから
		// 再度アクセスした場合は準備画面を表示する。終了画面は「ended=true」パラメータがある場合か、
		// リアルタイムで終了を検知した場合のみ表示する。

		// デバッグ: セッション情報を確認
		console.log('[DEBUG] セッション情報:', data.sessionDetails);
		console.log('[DEBUG] isChief:', data.isChief);
		console.log('[DEBUG] isSessionActive:', data.isSessionActive);
		console.log('[DEBUG] isSessionEnded (初期値):', isSessionEnded);
		console.log('[DEBUG] isTournamentMode:', data.isTournamentMode);

		// デバッグ: セッションを読み取れるか確認
		const { data: sessionTest, error: sessionError } = await supabase
			.from('sessions')
			.select('*')
			.eq('id', data.sessionDetails.id)
			.single();
		console.log('[DEBUG] セッション読み取りテスト:', { sessionTest, sessionError });

		// 一般検定員の場合、status変化を監視
		if (!data.isChief) {
			const sessionId = data.sessionDetails.id;
			console.log('[一般検定員] status監視をセットアップ中...', { sessionId });

			// Realtimeで sessions.status の変更を監視
			const channelName = `session-status-${sessionId}-${Date.now()}`;
			console.log('[一般検定員] チャンネル名:', channelName);

			realtimeChannel = supabase
				.channel(channelName)
				.on(
					'postgres_changes',
					{
						event: 'UPDATE',
						schema: 'public',
						table: 'sessions',
						filter: `id=eq.${sessionId}`
					},
					async (payload) => {
						console.log('[一般検定員/realtime] セッション更新を検知:', payload);
						const newStatus = payload.new.status;
						const newPromptId = payload.new.active_prompt_id;

						console.log('[一般検定員/realtime] status:', newStatus);
						console.log('[一般検定員/realtime] active_prompt_id:', newPromptId);

						// 既に終了画面を表示している場合は、状態変更を行わない
						if (isSessionEnded) {
							console.log('[一般検定員/realtime] 終了画面表示中のため、状態変更をスキップ');
							return;
						}

						// セッションが終了した場合、検定終了画面に遷移
						if (newStatus === 'ended') {
							console.log('[一般検定員/realtime] ✅ セッション終了を検知。終了画面に遷移します。');
							isSessionEnded = true;
							goto(`/session/${sessionId}?ended=true`);
							return;
						}

						// 新しい採点指示IDがセットされたら
						if (newPromptId && payload.old.active_prompt_id !== newPromptId) {
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

								// discipline カラムの値でモードを判定
								const mode = promptData.discipline; // 'tournament', 'training', または実際の discipline

								if (mode === 'tournament' || mode === 'training') {
									// 大会・研修モード: participantId を取得
									const { data: participant } = await supabase
										.from('participants')
										.select('id')
										.eq('session_id', sessionId)
										.eq('bib_number', promptData.bib_number)
										.maybeSingle();

									if (participant) {
										const eventId = promptData.level; // level カラムに eventId を保存している
										if (mode === 'tournament') {
											console.log('[一般検定員/大会] 採点画面に遷移:', `/session/${sessionId}/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
											goto(`/session/${sessionId}/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
										} else {
											console.log('[一般検定員/研修] 採点画面に遷移:', `/session/${sessionId}/score/training/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
											goto(`/session/${sessionId}/score/training/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
										}
									}
								} else {
									// 検定モード: /session/[id]/[discipline]/[level]/[event]/score
									console.log('[一般検定員/検定] 採点画面に遷移:', {
										sessionId,
										discipline: promptData.discipline,
										level: promptData.level,
										event: promptData.event_name
									});
									goto(
										`/session/${sessionId}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score`
									);
								}
							}
						}
					}
				)
				.subscribe(async (status) => {
					console.log('[一般検定員] Realtimeチャンネルの状態:', status);
					if (status === 'SUBSCRIBED') {
						console.log('[一般検定員] ✅ リアルタイム接続成功');

						// Realtimeのバックアップとして、2秒ごとにポーリングでstatusとactive_prompt_idをチェック
						pollingInterval = setInterval(async () => {
							console.log('[一般検定員/polling] セッション状態をポーリング中...');

							// 既に終了画面を表示している場合はポーリングを継続するが、状態変更は行わない
							if (isSessionEnded) {
								console.log('[一般検定員/polling] 終了画面表示中のため、状態変更をスキップ');
								return;
							}

							const { data: sessionData, error } = await supabase
								.from('sessions')
								.select('status, active_prompt_id')
								.eq('id', sessionId)
								.single();

							if (!error && sessionData) {
								const currentStatus = sessionData.status;
								console.log('[一般検定員/polling] status:', currentStatus, '前回:', previousStatus);

								// 初回のポーリング時
								if (previousStatus === null) {
									console.log('[一般検定員/polling] 初回ポーリング - 状態を記録');
									previousStatus = currentStatus;

									// 初回から既に ended の場合は終了画面に遷移
									if (currentStatus === 'ended') {
										console.log('[一般検定員/polling] ✅ セッションは既に終了しています。終了画面に遷移します。');
										isSessionEnded = true;
										try {
											const targetUrl = `/session/${sessionId}?ended=true`;
											console.log('[一般検定員/polling] 遷移先URL:', targetUrl);
											await goto(targetUrl);
											console.log('[一般検定員/polling] goto完了');
										} catch (error) {
											console.error('[一般検定員/polling] ❌ goto失敗:', error);
										}
									}
									return;
								}

								// statusが 'ended' に変化した場合
								if (previousStatus !== 'ended' && currentStatus === 'ended') {
									console.log('[一般検定員/polling] ✅ セッション終了を検知。終了画面に遷移します。');
									isSessionEnded = true;
									try {
										const targetUrl = `/session/${sessionId}?ended=true`;
										console.log('[一般検定員/polling] 遷移先URL:', targetUrl);
										await goto(targetUrl);
										console.log('[一般検定員/polling] goto完了');
									} catch (error) {
										console.error('[一般検定員/polling] ❌ goto失敗:', error);
									}
								}

								previousStatus = currentStatus;
							}
						}, 2000);

						// 接続成功後、ページロード時に既にactive_prompt_idが設定されているかチェック
						const currentPromptId = data.sessionDetails.active_prompt_id;
						if (currentPromptId) {
							console.log('[一般検定員] 既存の採点指示を検知:', currentPromptId);
							// 採点指示の詳細を取得
							const { data: promptData, error } = await supabase
								.from('scoring_prompts')
								.select('*')
								.eq('id', currentPromptId)
								.single();

							if (!error && promptData) {
								console.log('[一般検定員] 採点指示データ取得成功。採点画面に遷移します:', promptData);
								currentBib.set(promptData.bib_number);

								// discipline カラムの値でモードを判定
								const mode = promptData.discipline; // 'tournament', 'training', または実際の discipline

								if (mode === 'tournament' || mode === 'training') {
									// 大会・研修モード: participantId を取得
									const { data: participant } = await supabase
										.from('participants')
										.select('id')
										.eq('session_id', sessionId)
										.eq('bib_number', promptData.bib_number)
										.maybeSingle();

									if (participant) {
										const eventId = promptData.level; // level カラムに eventId を保存している
										if (mode === 'tournament') {
											console.log('[一般検定員/大会] 採点画面に遷移(既存):', `/session/${sessionId}/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
											goto(`/session/${sessionId}/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
										} else {
											console.log('[一般検定員/研修] 採点画面に遷移(既存):', `/session/${sessionId}/score/training/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
											goto(`/session/${sessionId}/score/training/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}`);
										}
									}
								} else {
									// 検定モード
									goto(
										`/session/${sessionId}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score`
									);
								}
							}
						}
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
		if (pollingInterval) {
			clearInterval(pollingInterval);
		}
	});

	function selectDiscipline(discipline: string) {
		// 次のステップ（級選択）のページへ移動
		goto(`/session/${data.sessionDetails.id}/${discipline}`);
	}

	function goToTournamentEvents() {
		goto(`/session/${data.sessionDetails.id}/tournament-events`);
	}

	function goToTournamentSetup() {
		goto(`/session/${data.sessionDetails.id}/tournament-setup`);
	}
</script>

<Header />

<div class="container">
	{#if isSessionEnded}
		<!-- 終了画面（主任・一般共通） -->
		<div class="instruction">{data.isTournamentMode ? '大会終了' : data.isTrainingMode ? '研修終了' : '検定終了'}</div>
		<div class="end-message">
			<p>この{data.isTournamentMode ? '大会' : data.isTrainingMode ? '研修' : '検定'}は終了しました。</p>
		</div>
	{:else if data.isChief && data.isTrainingMode}
		<!-- 研修モード: 主任検定員の画面 -->
		{#if data.hasEvents}
			<div class="instruction">研修モード</div>
			<div class="tournament-info">
				{#if data.trainingSession?.is_multi_judge}
					<p>種目選択画面に進んでください</p>
					<p class="info-text">主任検定員が採点指示を出します</p>
				{:else}
					<p>各検定員が自由に採点できます</p>
					<p class="info-text">種目選択画面から開始してください</p>
				{/if}
			</div>
			<div class="list-keypad">
				<NavButton variant="primary" on:click={() => goto(`/session/${data.sessionDetails.id}/training-events`)}>
					種目選択へ進む
				</NavButton>
			</div>
		{:else}
			<div class="instruction">研修設定が必要です</div>
			<div class="tournament-info">
				<p>種目が登録されていません。</p>
				<p>先に種目を設定してください。</p>
			</div>
			<div class="list-keypad">
				<NavButton variant="primary" on:click={() => goto(`/session/${data.sessionDetails.id}/training-setup`)}>
					研修設定へ進む
				</NavButton>
			</div>
		{/if}
	{:else if data.isChief}
		{#if data.isTournamentMode}
			<!-- 大会モード: 種目選択へ -->
			{#if data.hasEvents}
				<div class="instruction">大会モード</div>
				<div class="tournament-info">
					<p>種目選択画面に進んでください</p>
				</div>
				<div class="list-keypad">
					<NavButton variant="primary" on:click={goToTournamentEvents}>
						種目選択へ進む
					</NavButton>
					<NavButton on:click={goToTournamentSetup}>大会設定を変更</NavButton>
				</div>
			{:else}
				<div class="instruction">大会設定が必要です</div>
				<div class="tournament-info">
					<p>種目が登録されていません。</p>
					<p>先に種目を設定してください。</p>
				</div>
				<div class="list-keypad">
					<NavButton variant="primary" on:click={goToTournamentSetup}>
						大会設定へ進む
					</NavButton>
				</div>
			{/if}
		{:else}
			<!-- 検定モード: 種別選択 -->
			<div class="instruction">種別を選択してください</div>
			<div class="list-keypad">
				{#each data.disciplines as discipline}
					<NavButton on:click={() => selectDiscipline(discipline)}>
						{discipline}
					</NavButton>
				{/each}
			</div>
		{/if}
	{:else}
		<!-- 一般検定員の準備画面 -->
		{#if data.isTrainingMode && !data.trainingSession?.is_multi_judge}
			<!-- 研修モードで複数検定員OFF: 自由採点モード -->
			<div class="instruction">自由採点モード</div>
			<div class="wait-message">
				<p>種目選択画面から採点を開始できます。</p>
				<div class="nav-buttons">
					<NavButton variant="primary" on:click={() => goto(`/session/${data.sessionDetails.id}/training-events`)}>
						種目選択へ進む
					</NavButton>
				</div>
			</div>
		{:else if data.isTournamentMode && !data.sessionDetails.is_multi_judge}
			<!-- 大会モードで複数検定員OFF: 自由採点モード -->
			<div class="instruction">自由採点モード</div>
			<div class="wait-message">
				<p>種目選択画面から採点を開始できます。</p>
				<div class="nav-buttons">
					<NavButton variant="primary" on:click={() => goto(`/session/${data.sessionDetails.id}/tournament-events`)}>
						種目選択へ進む
					</NavButton>
				</div>
			</div>
		{:else if !data.isTrainingMode && !data.isTournamentMode && !data.sessionDetails.is_multi_judge && data.disciplines}
			<!-- 検定モードで複数検定員OFF: 自由採点モード（種別選択） -->
			<div class="instruction">種別を選択してください</div>
			<div class="list-keypad">
				{#each data.disciplines as discipline}
					<NavButton on:click={() => selectDiscipline(discipline)}>
						{discipline}
					</NavButton>
				{/each}
			</div>
		{:else}
			<!-- 複数検定員モード: 準備中表示 -->
			<div class="instruction">準備中…</div>
			<div class="wait-message">
				<p>主任検定員が採点の準備をしています。</p>
				<p>しばらくお待ちください。</p>
				<div class="loading"></div>
			</div>
		{/if}
	{/if}
	<div class="nav-buttons">
		<NavButton on:click={() => goto('/dashboard')}>
			セッション選択画面に戻る
		</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 800px;
		margin: 0 auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		color: var(--text-primary);
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
	.tournament-info {
		margin: 24px auto;
		color: var(--text-secondary);
		line-height: 1.6;
		max-width: 600px;
	}
	.wait-message {
		margin: 24px auto;
		color: var(--text-secondary);
		line-height: 1.6;
		max-width: 600px;
	}
	.end-message {
		margin: 24px auto;
		padding: 24px;
		background: var(--bg-white);
		border-radius: 12px;
		border: 2px solid var(--border-light);
		color: var(--text-primary);
		line-height: 1.6;
		font-size: 16px;
		max-width: 600px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}
	.loading {
		display: inline-block;
		width: 20px;
		height: 20px;
		border: 2px solid rgba(0, 0, 0, 0.1);
		border-top-color: var(--primary-orange);
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-top: 20px;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.info-text {
		font-size: 14px;
		color: var(--text-secondary);
		margin-top: 8px;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 600px;
		}
		.instruction {
			font-size: 36px;
			margin-bottom: 40px;
		}
		.list-keypad {
			gap: 16px;
		}
		.tournament-info {
			font-size: 18px;
			margin: 32px auto;
		}
		.wait-message {
			font-size: 18px;
			margin: 32px auto;
		}
		.end-message {
			font-size: 18px;
			padding: 32px;
			margin: 32px auto;
		}
		.nav-buttons {
			margin-top: 40px;
		}
	}

	/* PC対応: デスクトップ */
	@media (min-width: 1024px) {
		.instruction {
			font-size: 42px;
		}
		.list-keypad {
			gap: 20px;
		}
	}
</style>
