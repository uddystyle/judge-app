<script lang="ts">
	import { currentSession, currentBib, currentDiscipline, currentLevel, currentEvent } from '$lib/stores';
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { supabase } from '$lib/supabaseClient';

	// サーバーから渡されたデータを受け取る
	export let data: PageData;
	let realtimeChannel: any;
	let notificationChannel: any;
	let pollingInterval: any;
	let notificationPollingInterval: any;
	let previousIsActive: boolean | null = null; // ポーリングで前回の状態を記憶
	let lastNotificationId: number | null = null; // 最後に確認した通知ID
	// URLパラメータで終了フラグをチェック
	let isSessionEnded = false;

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

		// URLパラメータで終了フラグをチェック（リアルタイムで終了した場合のみ）
		const urlParams = new URLSearchParams(window.location.search);
		if (urlParams.get('ended') === 'true') {
			console.log('[DEBUG] URLパラメータで終了フラグを検知（リアルタイム終了）');
			isSessionEnded = true;
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

		if (!data.isChief) {
			const sessionId = data.sessionDetails.id;
			console.log('[一般検定員] リアルタイムリスナーをセットアップ中...', { sessionId });

			// 通知テーブルの監視（INSERTイベントのみ）
			const notificationChannelName = `session-notifications-${sessionId}-${Date.now()}`;
			console.log('[一般検定員] 通知チャンネル名:', notificationChannelName);

			// デバッグ: 既存の通知を確認
			const { data: existingNotifications, error: notifError } = await supabase
				.from('session_notifications')
				.select('*')
				.eq('session_id', sessionId)
				.order('created_at', { ascending: false })
				.limit(5);
			console.log('[一般検定員] 既存の通知:', existingNotifications, 'エラー:', notifError);

			// 最新の通知IDを記録
			if (existingNotifications && existingNotifications.length > 0) {
				lastNotificationId = existingNotifications[0].id;
				console.log('[一般検定員] 最後の通知ID:', lastNotificationId);
			}

			// 通知テーブルをポーリング（Realtimeの代替）
			notificationPollingInterval = setInterval(async () => {
				console.log('[一般検定員] 通知をポーリング中...', { lastNotificationId });
				const { data: newNotifications, error } = await supabase
					.from('session_notifications')
					.select('*')
					.eq('session_id', sessionId)
					.order('created_at', { ascending: false })
					.limit(1);

				if (!error && newNotifications && newNotifications.length > 0) {
					const latestNotification = newNotifications[0];
					console.log('[一般検定員] 最新の通知:', latestNotification);

					// 新しい通知が見つかった場合
					if (lastNotificationId === null || latestNotification.id > lastNotificationId) {
						console.log('[一般検定員] 🔔 新しい通知を検知:', latestNotification);
						lastNotificationId = latestNotification.id;

						const notificationType = latestNotification.notification_type;
						console.log('[一般検定員] 通知タイプ:', notificationType);

						if (notificationType === 'session_ended') {
							console.log('[一般検定員] ✅ 終了通知を検知。終了画面に遷移します。');
							isSessionEnded = true;
						}
						// 注: session_restarted通知は削除された再開機能用なので処理しない
					}
				}
			}, 2000); // 2秒ごとにポーリング

			notificationChannel = supabase
				.channel(notificationChannelName)
				.on(
					'postgres_changes',
					{
						event: 'INSERT',
						schema: 'public',
						table: 'session_notifications',
						filter: `session_id=eq.${sessionId}`
					},
					async (payload) => {
						console.log('[一般検定員/waiting] 🔔 通知を受信:', payload);
						const notificationType = payload.new.notification_type;
						console.log('[一般検定員/waiting] 通知タイプ:', notificationType);

						if (notificationType === 'session_ended') {
							console.log('[一般検定員/waiting] ✅ 終了通知を受信。終了画面に遷移します。');
							isSessionEnded = true;
						}
						// 注: session_restarted通知は削除された再開機能用なので処理しない
					}
				)
				.subscribe((status) => {
					console.log('[一般検定員] 通知チャンネルの状態:', status);
					if (status === 'SUBSCRIBED') {
						console.log('[一般検定員] ✅ 通知リアルタイム接続成功');
					} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
						console.error('[一般検定員] ❌ 通知チャンネル接続エラー');
					}
				});

			// 'sessions'テーブルの、このセッションIDの行に対するUPDATEのみを監視
			const channelName = `session-updates-${sessionId}-${Date.now()}`;
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
						console.log('[一般検定員/waiting] セッション更新を検知:', payload);
						const newPromptId = payload.new.active_prompt_id;
						const isActive = payload.new.is_active;
						console.log('[一般検定員/waiting] is_active:', isActive);
						console.log('[一般検定員/waiting] payload.old:', payload.old);
						console.log('[一般検定員/waiting] 現在の isSessionEnded:', isSessionEnded);

						// 既に終了画面を表示している場合は、状態変更を行わない
						if (isSessionEnded) {
							console.log('[一般検定員/waiting] 終了画面表示中のため、状態変更をスキップ');
							return;
						}

						// セッションが終了した場合、検定終了画面を表示
						if (isActive === false && !isSessionEnded) {
							console.log('[一般検定員/waiting] ✅ 検定終了を検知。検定終了画面を表示します。');
							console.log('[一般検定員/waiting] 条件確認: isActive === false:', isActive === false);
							console.log('[一般検定員/waiting] 条件確認: !isSessionEnded:', !isSessionEnded);
							isSessionEnded = true;
							console.log('[一般検定員/waiting] isSessionEnded を true に設定完了:', isSessionEnded);
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
								// 採点画面へ移動（大会モード・検定モード共通）
								goto(
									`/session/${sessionId}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score`
								);
							}
						}
					}
				)
				.subscribe(async (status) => {
					console.log('[一般検定員] Realtimeチャンネルの状態:', status);
					if (status === 'SUBSCRIBED') {
						console.log('[一般検定員] ✅ リアルタイム接続成功');

						// Realtimeのバックアップとして、3秒ごとにポーリングでis_activeをチェック
						pollingInterval = setInterval(async () => {
							console.log('[一般検定員/polling] セッション状態をポーリング中...');
							console.log('[一般検定員/polling] 現在の isSessionEnded:', isSessionEnded);

							// 既に終了画面を表示している場合はポーリングを継続するが、状態変更は行わない
							if (isSessionEnded) {
								console.log('[一般検定員/polling] 終了画面表示中のため、状態変更をスキップ');
								return;
							}

							const { data: sessionData, error } = await supabase
								.from('sessions')
								.select('is_active')
								.eq('id', sessionId)
								.single();

							if (!error && sessionData) {
								const isActive = sessionData.is_active;
								console.log('[一般検定員/polling] is_active:', isActive);
								console.log('[一般検定員/polling] previousIsActive:', previousIsActive);

								// 初回のポーリング時は前回の状態を記録するだけ
								if (previousIsActive === null) {
									console.log('[一般検定員/polling] 初回ポーリング - 状態を記録');
									previousIsActive = isActive;
									return;
								}

								// 状態が変化した場合のみ処理
								if (previousIsActive !== isActive) {
									console.log('[一般検定員/polling] 状態変化を検知:', previousIsActive, '->', isActive);

									// 終了した場合（true -> false）
									if (isActive === false && previousIsActive === true) {
										console.log('[一般検定員/polling] ✅ 検定終了を検知（ポーリング）');
										isSessionEnded = true;
									}
									// 注: 再開機能は削除されたため、false -> true の処理は行わない

									previousIsActive = isActive;
								}
							}
						}, 3000);

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
								goto(
									`/session/${sessionId}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score`
								);
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
		if (notificationChannel) {
			supabase.removeChannel(notificationChannel);
		}
		if (pollingInterval) {
			clearInterval(pollingInterval);
		}
		if (notificationPollingInterval) {
			clearInterval(notificationPollingInterval);
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
		<div class="instruction">{data.isTournamentMode ? '大会終了' : '検定終了'}</div>
		<div class="end-message">
			<p>この{data.isTournamentMode ? '大会' : '検定'}は終了しました。</p>
		</div>
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
		<div class="instruction">準備中…</div>
		<div class="wait-message">
			<p>主任検定員が採点の準備をしています。</p>
			<p>しばらくお待ちください。</p>
		</div>
		<div class="loading"></div>
	{/if}
	<div class="nav-buttons">
		<NavButton on:click={() => goto('/dashboard')}>
			{data.isTournamentMode ? '大会選択に戻る' : '検定選択に戻る'}
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
