<script lang="ts">
	import { currentSession, currentBib, currentDiscipline, currentLevel, currentEvent } from '$lib/stores';
	import type { PageData, ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { supabase } from '$lib/supabaseClient';
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';

	// サーバーから渡されたデータを受け取る
	export let data: PageData;
	export const form: ActionData = undefined;
	let realtimeChannel: any;
	let pollingInterval: any;
	let previousStatus: string | null = null; // ポーリングで前回の状態を記憶
	let isPageActive = true; // ページがアクティブかどうかを追跡
	// URLパラメータで終了フラグをチェック（リアクティブに監視）
	// ただし、restart=true パラメータがある場合は終了フラグを無視
	$: isSessionEnded = $page.url.searchParams.get('restart') === 'true'
		? false
		: $page.url.searchParams.get('ended') === 'true';

	// URLパラメータから join フラグを取得（リアクティブに監視）
	$: shouldShowJoinUI = $page.url.searchParams.get('join') === 'true';

	// 研修モード用の変数
	let selectedUserId: string = '';

	// デバッグ: isSessionEndedの変更を監視
	$: {
		console.log('[DEBUG] isSessionEnded changed:', isSessionEnded, 'isChief:', data.isChief, 'URL:', $page.url.href);
		console.log('[DEBUG] URL params:', {
			ended: $page.url.searchParams.get('ended'),
			restart: $page.url.searchParams.get('restart'),
			guest: $page.url.searchParams.get('guest')
		});
	}

	// このページが表示されたら、グローバルなストアを更新する
	onMount(async () => {
		console.log('[Session Detail] ========== FULL DATA ==========');
		console.log('[Session Detail] hasOrganization:', data.hasOrganization);
		console.log('[Session Detail] user:', data.user);
		console.log('[Session Detail] profile:', data.profile);
		console.log('[Session Detail] _debug:', data._debug);
		console.log('[Session Detail] ALL KEYS:', Object.keys(data));
		console.log('[Session Detail] FULL DATA:', data);
		currentSession.set(data.sessionDetails);

		// セッション選択画面に戻ったので、種目情報をクリア
		currentDiscipline.set(null);
		currentLevel.set(null);
		currentEvent.set(null);
		currentBib.set(null);

		// 注: セッションが終了していても（is_active: false）、ダッシュボードから
		// 再度アクセスした場合は準備画面を表示する。終了画面は「ended=true」パラメータがある場合か、
		// リアルタイムで終了を検知した場合のみ表示する。
		// isSessionEndedはリアクティブステートメントで監視しているため、ここでは不要。

		// デバッグ: セッション情報を確認
		console.log('[DEBUG] セッション情報:', data.sessionDetails);
		console.log('[DEBUG] isChief:', data.isChief);
		console.log('[DEBUG] isSessionActive:', data.isSessionActive);
		console.log('[DEBUG] isSessionEnded (初期値):', isSessionEnded);
		console.log('[DEBUG] isTournamentMode:', data.isTournamentMode);
		console.log('[DEBUG] user:', data.user);
		console.log('[DEBUG] chief_judge_id:', data.sessionDetails.chief_judge_id);

		// デバッグ: セッションを読み取れるか確認
		const { data: sessionTest, error: sessionError } = await supabase
			.from('sessions')
			.select('*')
			.eq('id', data.sessionDetails.id)
			.single();
		console.log('[DEBUG] セッション読み取りテスト:', { sessionTest, sessionError });

		// 一般検定員とゲストユーザーの場合、status変化を監視
		// ただし、以下の場合は監視不要：
		// - 終了画面として表示される場合（セッション再開ボタンで再参加）
		// - ゲストユーザーの参加完了画面（セッションに参加ボタンで待機画面へ）
		const shouldSetupMonitoring = !data.isChief && !isSessionEnded && (shouldShowJoinUI || !data.guestIdentifier);
		console.log('[DEBUG] Realtime監視チェック:', {
			isChief: data.isChief,
			isSessionEnded,
			shouldShowJoinUI,
			isGuest: !!data.guestIdentifier,
			guestIdentifier: data.guestIdentifier,
			urlParams: $page.url.searchParams.toString(),
			willSetup: shouldSetupMonitoring
		});
		if (shouldSetupMonitoring) {
			const sessionId = data.sessionDetails.id;
			console.log('[一般検定員] ========== 監視セットアップ開始 ==========');
			console.log('[一般検定員] sessionId:', sessionId);
			console.log('[一般検定員] isTournamentMode:', data.isTournamentMode);
			console.log('[一般検定員] current status:', data.sessionDetails.status);
			console.log('[一般検定員] current is_active:', data.sessionDetails.is_active);

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
						console.log('[一般検定員/realtime] ========== Realtime更新検知 ==========');
						console.log('[一般検定員/realtime] 時刻:', new Date().toISOString());
						console.log('[一般検定員/realtime] payload:', payload);
						const oldStatus = payload.old.status;
						const newStatus = payload.new.status;
						const oldIsActive = payload.old.is_active;
						const newIsActive = payload.new.is_active;
						const newPromptId = payload.new.active_prompt_id;

						console.log('[一般検定員/realtime] status変化:', oldStatus, '→', newStatus);
						console.log('[一般検定員/realtime] is_active変化:', oldIsActive, '→', newIsActive);
						console.log('[一般検定員/realtime] active_prompt_id:', newPromptId);

						// 既に終了画面を表示している場合は、状態変更をスキップ
						if (isSessionEnded) {
							console.log('[一般検定員/realtime] ⚠️ 終了画面表示中のため、状態変更をスキップ');
							return;
						}

						// セッションが終了した場合、検定終了画面に遷移
						console.log('[一般検定員/realtime] ========== 終了検知チェック ==========');
						console.log('[一般検定員/realtime] newStatus === "ended":', newStatus === 'ended');
						if (newStatus === 'ended') {
							console.log('[一般検定員/realtime] ✅✅✅ セッション終了を検知！終了画面に遷移します！');
							if (!isPageActive) {
								console.log('[一般検定員/realtime] ⚠️ ページが非アクティブのため、遷移をスキップ');
								return;
							}
							// リソースをクリーンアップ
							console.log('[一般検定員/realtime] リアルタイム接続とポーリングを停止します');
							if (realtimeChannel) {
								supabase.removeChannel(realtimeChannel);
								realtimeChannel = null;
							}
							if (pollingInterval) {
								clearInterval(pollingInterval);
								pollingInterval = null;
							}
							isSessionEnded = true;
							const guestParam = data.guestIdentifier ? `&guest=${data.guestIdentifier}` : '';
							goto(`/session/${sessionId}?ended=true${guestParam}`);
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
										const guestParam = data.guestIdentifier ? `&guest=${data.guestIdentifier}` : '';
										if (mode === 'tournament') {
											console.log('[一般検定員/大会] 採点画面に遷移:', `/session/${sessionId}/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}${guestParam}`);
											goto(`/session/${sessionId}/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}${guestParam}`);
										} else {
											console.log('[一般検定員/研修] 採点画面に遷移:', `/session/${sessionId}/score/training/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}${guestParam}`);
											goto(`/session/${sessionId}/score/training/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}${guestParam}`);
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
									const guestParam = data.guestIdentifier ? `?guest=${data.guestIdentifier}&join=true` : '';
									goto(
										`/session/${sessionId}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score${guestParam}`
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
						let previousActivePromptId: string | null = null;
						pollingInterval = setInterval(async () => {
							console.log('[一般検定員/polling] ========== ポーリング実行 ==========');
							console.log('[一般検定員/polling] 時刻:', new Date().toISOString());

							// 現在のパスをチェック - セッションページから離れていたらポーリングを停止
							const currentPath = window.location.pathname;
							console.log('[一般検定員/polling] 現在のパス:', currentPath);
							if (!currentPath.includes(`/session/${sessionId}`)) {
								console.log('[一般検定員/polling] ⚠️ セッションページから離れているため、ポーリングを停止します');
								if (pollingInterval) {
									clearInterval(pollingInterval);
								}
								return;
							}

							console.log('[一般検定員/polling] データベースクエリ実行中...', { sessionId });
							const { data: sessionData, error } = await supabase
								.from('sessions')
								.select('status, active_prompt_id, is_active')
								.eq('id', sessionId)
								.single();

							console.log('[一般検定員/polling] クエリ結果:', { sessionData, error });

							if (!error && sessionData) {
								const currentStatus = sessionData.status;
								const currentActivePromptId = sessionData.active_prompt_id;
								const currentIsActive = sessionData.is_active;
								console.log('[一般検定員/polling] ========== 状態確認 ==========');
								console.log('[一般検定員/polling] status:', currentStatus, '(前回:', previousStatus + ')');
								console.log('[一般検定員/polling] is_active:', currentIsActive);
								console.log('[一般検定員/polling] active_prompt_id:', currentActivePromptId, '(前回:', previousActivePromptId + ')');

								// 既に終了画面を表示している場合は、状態変更をスキップ
								if (isSessionEnded) {
									console.log('[一般検定員/polling] 終了画面表示中のため、状態変更をスキップ');
									return;
								}

								// 初回のポーリング時
								if (previousStatus === null) {
									console.log('[一般検定員/polling] ========== 初回ポーリング ==========');
									console.log('[一般検定員/polling] 初回 - 状態を記録');
									const isJoining = $page.url.searchParams.get('join') === 'true';

									// 初回ポーリング時に既にセッションが終了している場合は即座に遷移
									if (currentStatus === 'ended') {
										console.log('[一般検定員/polling] ⚠️ 初回ポーリングで既にセッション終了を検知！');
										console.log('[一般検定員/polling] ✅✅✅ 終了画面に即座に遷移します！');
										if (!isPageActive) {
											console.log('[一般検定員/polling] ⚠️ ページが非アクティブのため、遷移をスキップ');
											return;
										}
										// リソースをクリーンアップ
										console.log('[一般検定員/polling] リアルタイム接続とポーリングを停止します');
										if (realtimeChannel) {
											supabase.removeChannel(realtimeChannel);
											realtimeChannel = null;
										}
										if (pollingInterval) {
											clearInterval(pollingInterval);
											pollingInterval = null;
										}
										isSessionEnded = true;
										try {
											const guestParam = data.guestIdentifier ? `&guest=${data.guestIdentifier}` : '';
											const targetUrl = `/session/${sessionId}?ended=true${guestParam}`;
											console.log('[一般検定員/polling] 遷移先URL:', targetUrl);
											await goto(targetUrl);
											console.log('[一般検定員/polling] goto完了');
										} catch (error) {
											console.error('[一般検定員/polling] ❌ goto失敗:', error);
										}
										return;
									}

									previousStatus = currentStatus;
									// セッション再参加直後の場合、既存のactive_prompt_idを無視してnullとして扱う
									// これにより、その後の新しい採点指示を確実に検知できる
									previousActivePromptId = isJoining ? null : currentActivePromptId;
									console.log('[一般検定員/polling] 状態記録:', {
										previousStatus,
										previousActivePromptId,
										isJoining,
										currentActivePromptId,
										currentIsActive
									});

									// 初回は状態を記録するだけで、終了画面への遷移は行わない（ただし既に終了している場合は上で遷移済み）
									console.log('[一般検定員/polling] 初回なので状態記録のみ。遷移はしない。');
									return;
								}

								// statusが 'ended' に変化した場合の検知
								console.log('[一般検定員/polling] ========== 終了検知チェック ==========');
								console.log('[一般検定員/polling] 条件1: previousStatus !== "ended":', previousStatus !== 'ended');
								console.log('[一般検定員/polling] 条件2: currentStatus === "ended":', currentStatus === 'ended');
								console.log('[一般検定員/polling] 両方満たす:', previousStatus !== 'ended' && currentStatus === 'ended');

								if (previousStatus !== 'ended' && currentStatus === 'ended') {
									console.log('[一般検定員/polling] ✅✅✅ セッション終了を検知！終了画面に遷移します！');
									if (!isPageActive) {
										console.log('[一般検定員/polling] ⚠️ ページが非アクティブのため、遷移をスキップ');
										return;
									}
									// リソースをクリーンアップ
									console.log('[一般検定員/polling] リアルタイム接続とポーリングを停止します');
									if (realtimeChannel) {
										supabase.removeChannel(realtimeChannel);
										realtimeChannel = null;
									}
									if (pollingInterval) {
										clearInterval(pollingInterval);
										pollingInterval = null;
									}
									isSessionEnded = true;
									try {
										const guestParam = data.guestIdentifier ? `&guest=${data.guestIdentifier}` : '';
										const targetUrl = `/session/${sessionId}?ended=true${guestParam}`;
										console.log('[一般検定員/polling] 遷移先URL:', targetUrl);
										await goto(targetUrl);
										console.log('[一般検定員/polling] goto完了');
									} catch (error) {
										console.error('[一般検定員/polling] ❌ goto失敗:', error);
									}
								}

								// active_prompt_idの変化を検知
								if (currentActivePromptId && currentActivePromptId !== previousActivePromptId) {
									console.log('[一般検定員/polling] ✅ 新しい採点指示を検知（ポーリング）:', currentActivePromptId);
									// 新しい指示の詳細を取得
									const { data: promptData, error: promptError } = await supabase
										.from('scoring_prompts')
										.select('*')
										.eq('id', currentActivePromptId)
										.single();

									if (!promptError && promptData) {
										console.log('[一般検定員/polling] 採点指示データ取得成功:', promptData);
										currentBib.set(promptData.bib_number);

										// discipline カラムの値でモードを判定
										const mode = promptData.discipline;

										if (mode === 'tournament' || mode === 'training') {
											// 大会・研修モード
											const { data: participant } = await supabase
												.from('participants')
												.select('id')
												.eq('session_id', sessionId)
												.eq('bib_number', promptData.bib_number)
												.maybeSingle();

											if (participant) {
												const eventId = promptData.level;
												const guestParam = data.guestIdentifier ? `&guest=${data.guestIdentifier}` : '';
												const targetUrl = mode === 'tournament'
													? `/session/${sessionId}/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}${guestParam}`
													: `/session/${sessionId}/score/training/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}${guestParam}`;
												console.log(`[一般検定員/polling/${mode}] 採点画面に遷移:`, targetUrl);
												await goto(targetUrl);
												return;
											}
										} else {
											// 検定モード
											const guestParam = data.guestIdentifier ? `?guest=${data.guestIdentifier}&join=true` : '';
											const targetUrl = `/session/${sessionId}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score${guestParam}`;
											console.log('[一般検定員/polling/検定] 採点画面に遷移:', targetUrl);
											await goto(targetUrl);
											return;
										}
									}
								}

								previousStatus = currentStatus;
								previousActivePromptId = currentActivePromptId;
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
										const guestParam = data.guestIdentifier ? `&guest=${data.guestIdentifier}` : '';
										if (mode === 'tournament') {
											console.log('[一般検定員/大会] 採点画面に遷移(既存):', `/session/${sessionId}/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}${guestParam}`);
											goto(`/session/${sessionId}/score/tournament/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}${guestParam}`);
										} else {
											console.log('[一般検定員/研修] 採点画面に遷移(既存):', `/session/${sessionId}/score/training/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}${guestParam}`);
											goto(`/session/${sessionId}/score/training/${eventId}/input?bib=${promptData.bib_number}&participantId=${participant.id}${guestParam}`);
										}
									}
								} else {
									// 検定モード
									const guestParam = data.guestIdentifier ? `?guest=${data.guestIdentifier}&join=true` : '';
									goto(
										`/session/${sessionId}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score${guestParam}`
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
		console.log('[DEBUG] onDestroy実行 - ページを離れます');
		isPageActive = false; // ページを離れたことを記録
		if (realtimeChannel) {
			supabase.removeChannel(realtimeChannel);
		}
		if (pollingInterval) {
			clearInterval(pollingInterval);
		}
	});

	function selectDiscipline(discipline: string) {
		// 次のステップ（級選択）のページへ移動
		const guestParam = data.guestIdentifier ? `?guest=${data.guestIdentifier}&join=true` : '';
		goto(`/session/${data.sessionDetails.id}/${discipline}${guestParam}`);
	}

	function goToTournamentEvents() {
		const guestParam = data.guestIdentifier ? `?guest=${data.guestIdentifier}` : '';
		goto(`/session/${data.sessionDetails.id}/tournament-events${guestParam}`);
	}

	function goToTournamentSetup() {
		const guestParam = data.guestIdentifier ? `?guest=${data.guestIdentifier}` : '';
		goto(`/session/${data.sessionDetails.id}/tournament-setup${guestParam}`);
	}
</script>

<Header pageUser={data.user} pageProfile={data.profile} hasOrganization={data.hasOrganization} isGuest={!data.user && !!data.guestIdentifier} guestName={data.guestParticipant?.guest_name || null} />

<!-- デバッグ情報 -->
{#if data._debug}
<div style="position: fixed; top: 80px; right: 20px; background: #fff; border: 2px solid #f00; padding: 10px; z-index: 9999; font-size: 12px; max-width: 300px;">
	<strong style="color: #f00;">DEBUG INFO</strong><br>
	userId: {data._debug.userId || 'none'}<br>
	hasUser: {data._debug.hasUser}<br>
	hasOrganization: {data._debug.hasOrganization}<br>
	guestIdentifier: {data._debug.guestIdentifier || 'none'}<br>
	<br>
	<strong>Header receives:</strong><br>
	hasOrganization: {data.hasOrganization}<br>
	isGuest: {!data.user && !!data.guestIdentifier}
</div>
{/if}

<div class="container">
	{#if isSessionEnded}
		<!-- 終了画面（主任・一般共通） -->
		<div class="instruction">{data.isTournamentMode ? '大会終了' : data.isTrainingMode ? '研修終了' : '検定終了'}</div>
		<div class="end-message">
			<p>この{data.isTournamentMode ? '大会' : data.isTrainingMode ? '研修' : '検定'}は終了しました。</p>

			{#if !data.isChief && data.isTrainingMode}
				<!-- 研修モード: 主任検定員以外（一般検定員とゲストユーザー）に現在の設定を表示 -->
				<div class="settings-info">
					<p class="settings-label">現在の設定:</p>
					<div class="settings-badge" class:multi-judge-on={data.isMultiJudge} class:multi-judge-off={!data.isMultiJudge}>
						{#if data.isMultiJudge}
							複数検定員モード ON
						{:else}
							複数検定員モード OFF（自由採点）
						{/if}
					</div>
				</div>

				{#if data.isMultiJudge && data.guestIdentifier}
					<p class="info-text" style="margin-top: 16px; color: var(--text-secondary);">
						主任検定員がセッションを再開する場合は、<br>下のボタンから再参加できます。
					</p>
				{/if}

				<div class="nav-buttons" style="margin-top: 24px;">
					<!-- 設定変更確認ボタン（主任検定員以外全員に表示） -->
					<NavButton on:click={() => {
						// ページをリロードして最新の設定を取得（ended=true を維持）
						const url = data.guestIdentifier
							? `/session/${data.sessionDetails.id}?ended=true&guest=${data.guestIdentifier}`
							: `/session/${data.sessionDetails.id}?ended=true`;
						window.location.href = url;
					}}>
						設定の変更を確認
					</NavButton>

					{#if data.guestIdentifier}
						<!-- ゲストユーザー向け：セッション再開ボタン -->
						<NavButton variant="primary" on:click={() => {
							// 完全にページをリロードして監視を再開
							window.location.href = `/session/${data.sessionDetails.id}?guest=${data.guestIdentifier}&join=true`;
						}}>
							セッションに参加
						</NavButton>
					{/if}
				</div>
			{:else if !data.isChief && data.isTournamentMode}
				<!-- 大会モード: 主任検定員以外（一般検定員とゲストユーザー）に採点方式を表示 -->
				<p class="info-text" style="margin-top: 16px;">
					採点方式：{#if data.sessionDetails.exclude_extremes}5審3採（最高点・最低点を除く）{:else}3審3採{/if}
				</p>

				{#if data.guestIdentifier}
					<p class="info-text" style="margin-top: 16px; color: var(--text-secondary);">
						主任検定員がセッションを再開する場合は、<br>下のボタンから再参加できます。
					</p>
				{/if}

				<div class="nav-buttons" style="margin-top: 24px;">
					<!-- 設定変更確認ボタン（主任検定員以外全員に表示） -->
					<NavButton on:click={() => {
						// ページをリロードして最新の設定を取得（ended=true を維持）
						const url = data.guestIdentifier
							? `/session/${data.sessionDetails.id}?ended=true&guest=${data.guestIdentifier}`
							: `/session/${data.sessionDetails.id}?ended=true`;
						window.location.href = url;
					}}>
						設定の変更を確認
					</NavButton>

					{#if data.guestIdentifier}
						<!-- ゲストユーザー向け：セッション再開ボタン -->
						<NavButton variant="primary" on:click={() => {
							// 完全にページをリロードして監視を再開
							window.location.href = `/session/${data.sessionDetails.id}?guest=${data.guestIdentifier}&join=true`;
						}}>
							セッションに参加
						</NavButton>
					{/if}
				</div>
			{/if}
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
				<NavButton variant="primary" on:click={() => {
					const guestParam = data.guestIdentifier ? `?guest=${data.guestIdentifier}` : '';
					goto(`/session/${data.sessionDetails.id}/training-events${guestParam}`);
				}}>
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
		{#if data.guestIdentifier && !shouldShowJoinUI}
			<!-- ゲストユーザー: わかりやすい待機画面 -->
			<div class="guest-waiting-container">
				<div class="guest-waiting-icon">
					<svg class="checkmark-icon" width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
						<circle cx="40" cy="40" r="35" stroke="currentColor" stroke-width="3" fill="none" opacity="0.2"/>
						<path d="M25 40 L35 50 L55 30" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</div>
				<div class="instruction">参加完了</div>
				<div class="guest-wait-message">
					<p class="guest-wait-title">セッションへの参加が完了しました</p>
					<p class="guest-wait-subtitle">
						下のボタンからセッションに参加してください
					</p>
				</div>
				<!-- すべてのモード共通: セッションに参加ボタン -->
				<div class="guest-action-buttons">
					<NavButton variant="primary" on:click={() => {
						// ゲストパラメータを保持したままメインセッションページに戻る（待機画面へ遷移）
						window.location.href = `/session/${data.sessionDetails.id}?guest=${data.guestIdentifier}&join=true`;
					}}>
						セッションに参加
					</NavButton>
				</div>
			</div>
		{:else if data.isTrainingMode && !data.trainingSession?.is_multi_judge}
			<!-- 研修モードで複数検定員OFF: 自由採点モード -->
			<div class="instruction">自由採点モード</div>
			<div class="wait-message">
				<p>種目選択画面から採点を開始できます。</p>
				<div class="nav-buttons">
					<NavButton variant="primary" on:click={() => {
						const guestParam = data.guestIdentifier ? `?guest=${data.guestIdentifier}` : '';
						goto(`/session/${data.sessionDetails.id}/training-events${guestParam}`);
					}}>
						種目選択へ進む
					</NavButton>
				</div>
			</div>
		{:else if data.isTournamentMode && !data.isMultiJudge}
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
		{:else if !data.isTrainingMode && !data.isTournamentMode && !data.isMultiJudge && data.disciplines}
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
			<div class="waiting-container">
				<div class="waiting-icon">
					<svg class="clock-icon" width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
						<circle cx="40" cy="40" r="35" stroke="currentColor" stroke-width="3" opacity="0.2"/>
						<circle cx="40" cy="40" r="35" stroke="currentColor" stroke-width="3" stroke-dasharray="220" stroke-dashoffset="0" class="clock-circle"/>
						<line x1="40" y1="40" x2="40" y2="20" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="clock-hand-hour"/>
						<line x1="40" y1="40" x2="55" y2="40" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="clock-hand-minute"/>
						<circle cx="40" cy="40" r="3" fill="currentColor"/>
					</svg>
				</div>
				<div class="instruction">準備中…</div>
				<div class="wait-message">
					<p class="wait-title">主任検定員が採点の準備をしています</p>
					<p class="wait-subtitle">準備が完了すると自動的に表示されます</p>
				</div>
				<div class="pulse-indicator">
					<span class="pulse-dot"></span>
					<span class="pulse-dot"></span>
					<span class="pulse-dot"></span>
				</div>
			</div>
		{/if}
	{/if}
	{#if !data.guestIdentifier}
		<div class="nav-buttons">
			<NavButton on:click={() => goto('/dashboard')}>
				セッション選択画面に戻る
			</NavButton>
		</div>
	{/if}
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
	.waiting-container {
		margin: 48px auto;
		padding: 40px 24px;
		background: linear-gradient(135deg, rgba(0, 122, 255, 0.03) 0%, rgba(0, 122, 255, 0.08) 100%);
		border-radius: 20px;
		border: 2px solid rgba(0, 122, 255, 0.15);
		max-width: 500px;
		box-shadow: 0 4px 20px rgba(0, 122, 255, 0.08);
	}

	.waiting-icon {
		display: flex;
		justify-content: center;
		margin-bottom: 24px;
	}

	.clock-icon {
		color: var(--ios-blue);
	}

	.clock-circle {
		animation: dash 2s ease-in-out infinite;
	}

	.clock-hand-hour {
		transform-origin: 40px 40px;
		animation: rotate-hour 4s linear infinite;
	}

	.clock-hand-minute {
		transform-origin: 40px 40px;
		animation: rotate-minute 2s linear infinite;
	}

	@keyframes dash {
		0%, 100% {
			stroke-dashoffset: 0;
		}
		50% {
			stroke-dashoffset: 110;
		}
	}

	@keyframes rotate-hour {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes rotate-minute {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.wait-message {
		margin: 24px auto;
		text-align: center;
		max-width: 600px;
	}

	.wait-title {
		font-size: 18px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 12px;
		line-height: 1.5;
	}

	.wait-subtitle {
		font-size: 15px;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	.pulse-indicator {
		display: flex;
		justify-content: center;
		gap: 8px;
		margin-top: 28px;
	}

	.pulse-dot {
		width: 10px;
		height: 10px;
		background: var(--ios-blue);
		border-radius: 50%;
		animation: pulse 1.4s ease-in-out infinite;
	}

	.pulse-dot:nth-child(2) {
		animation-delay: 0.2s;
	}

	.pulse-dot:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes pulse {
		0%, 100% {
			transform: scale(1);
			opacity: 1;
		}
		50% {
			transform: scale(1.5);
			opacity: 0.5;
		}
	}

	.end-message {
		margin: 24px auto;
		padding: 24px;
		background: var(--bg-primary);
		border-radius: 12px;
		border: 2px solid var(--border-light);
		color: var(--text-primary);
		line-height: 1.6;
		font-size: 16px;
		max-width: 600px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}

	.info-text {
		font-size: 14px;
		color: var(--text-secondary);
		margin-top: 8px;
	}

	/* 設定情報表示 */
	.settings-info {
		margin-top: 20px;
		padding: 16px;
		background: #f8f9fa;
		border-radius: 8px;
		text-align: center;
	}

	.settings-label {
		font-size: 14px;
		color: var(--text-secondary);
		margin: 0 0 8px 0;
		font-weight: 500;
	}

	.settings-badge {
		display: inline-block;
		padding: 4px 12px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.01em;
		transition: all 0.2s;
	}

	.settings-badge.multi-judge-on {
		background: transparent;
		color: #6b7280;
		border: 1px solid #d1d5db;
	}

	.settings-badge.multi-judge-off {
		background: transparent;
		color: #6b7280;
		border: 1px solid #d1d5db;
	}

	/* ゲストユーザー待機画面 */
	.guest-waiting-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 40px 20px;
		gap: 24px;
	}

	.guest-waiting-icon {
		color: var(--accent-primary);
	}

	.checkmark-icon {
		animation: checkmark-appear 0.5s ease-out;
	}

	@keyframes checkmark-appear {
		0% {
			opacity: 0;
			transform: scale(0.5);
		}
		100% {
			opacity: 1;
			transform: scale(1);
		}
	}

	.guest-wait-message {
		max-width: 500px;
		text-align: center;
	}

	.guest-wait-title {
		font-size: 18px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 12px;
		line-height: 1.5;
	}

	.guest-wait-subtitle {
		font-size: 15px;
		color: var(--text-secondary);
		line-height: 1.6;
		margin: 0;
	}

	.guest-action-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
		max-width: 400px;
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
		.waiting-container {
			padding: 48px 32px;
			margin: 64px auto;
		}
		.wait-title {
			font-size: 20px;
		}
		.wait-subtitle {
			font-size: 16px;
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
