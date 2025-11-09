<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import Header from '$lib/components/Header.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import { enhance } from '$app/forms';
	import { supabase } from '$lib/supabaseClient';
	import { goto } from '$app/navigation';
	import { currentBib, userProfile } from '$lib/stores';
	import { get } from 'svelte/store';

	export let data: PageData;
	let scoreStatus: any = { scores: [], requiredJudges: 1 };
	let realtimeChannel: any;
	let pollingInterval: any;
	let sessionPollingInterval: any;
	let previousIsActive: boolean | null = null;

	let sessionId: string = '';
	let modeType: string = '';
	let eventId: string = '';
	let bib: string | null = null;

	let isChief = false;
	$: isChief = data.user?.id === data.sessionDetails?.chief_judge_id;

	async function fetchStatus() {
		if (!bib) {
			console.error('❌ Bib number is missing');
			return;
		}

		const isTrainingMode = data.isTrainingMode;
		console.log('[status] fetchStatus実行:', { isTrainingMode, modeType, eventId, bib });

		if (isTrainingMode) {
			// 研修モードの場合、training_scoresから取得
			const { data: participant } = await supabase
				.from('participants')
				.select('id')
				.eq('session_id', sessionId)
				.eq('bib_number', parseInt(bib))
				.maybeSingle();

			if (!participant) {
				console.error('❌ Participant not found');
				return;
			}

			const { data: trainingScores, error: scoresError } = await supabase
				.from('training_scores')
				.select('*')
				.eq('event_id', eventId)
				.eq('athlete_id', participant.id);

			console.log('[status] training_scores取得:', { trainingScores, scoresError });

			if (trainingScores) {
				// judge_idからprofilesテーブルを使って名前を取得
				const scoresWithNames = await Promise.all(
					trainingScores.map(async (s: any) => {
						const { data: profile } = await supabase
							.from('profiles')
							.select('full_name')
							.eq('id', s.judge_id)
							.single();

						return {
							judge_id: s.judge_id,
							judge_name: profile?.full_name || '不明',
							score: s.score
						};
					})
				);

				scoreStatus = {
					scores: scoresWithNames,
					requiredJudges: data.totalJudges || 1 // 研修モードでは参加検定員の総数
				};
			}
		} else {
			// 大会モードの場合、APIを使用して取得（以前の実装と同じ）
			const url = `/api/score-status/${sessionId}/${bib}?discipline=${encodeURIComponent(data.eventInfo.discipline)}&level=${encodeURIComponent(data.eventInfo.level)}&event=${encodeURIComponent(data.eventInfo.event_name)}`;

			const response = await fetch(url);

			if (response.ok) {
				const result = await response.json();
				const requiredJudges = data.sessionDetails?.exclude_extremes ? 5 : 3;
				scoreStatus = {
					...result,
					requiredJudges: requiredJudges
				};
			} else {
				const errorText = await response.text();
				console.error('❌ API Error:', response.status, errorText);
			}
		}
	}

	onMount(() => {
		// URLパラメータを取得
		sessionId = $page.params.id || '';
		modeType = $page.params.modeType || '';
		eventId = $page.params.eventId || '';
		bib = $page.url.searchParams.get('bib');

		console.log('[status/onMount] data:', data);
		console.log('[status/onMount] params:', { sessionId, modeType, eventId, bib });
		console.log('[status/onMount] totalJudges:', data.totalJudges, 'isTrainingMode:', data.isTrainingMode, 'isMultiJudge:', data.isMultiJudge);

		fetchStatus();
		pollingInterval = setInterval(fetchStatus, 3000); // Poll every 3 seconds

		// dataから直接判定（リアクティブステートメントに依存しない）
		const currentIsChief = data.user?.id === data.sessionDetails?.chief_judge_id;

		// セッション終了検知用のポーリング（主任・一般共通）
		sessionPollingInterval = setInterval(async () => {
			const { data: sessionData, error } = await supabase
				.from('sessions')
				.select('is_active')
				.eq('id', sessionId)
				.single();

			if (!error && sessionData) {
				const isActive = sessionData.is_active;
				console.log('[status/polling] is_active:', isActive, 'previousIsActive:', previousIsActive);
				if (previousIsActive === null) {
					previousIsActive = isActive;
					return;
				}
				if (previousIsActive !== isActive && isActive === false && previousIsActive === true) {
					console.log('[status/polling] ✅ 検定終了を検知（ポーリング） → 終了画面に遷移');
					goto(`/session/${sessionId}?ended=true`);
				}
				previousIsActive = isActive;
			}
		}, 3000);

		// 一般検定員の場合、active_prompt_idがクリアされたら待機画面に遷移
		if (!currentIsChief) {
			console.log('[一般検定員/status] リアルタイムリスナーをセットアップ中...', { sessionId });
			realtimeChannel = supabase
				.channel(`session-finalize-${sessionId}`)
				.on(
					'postgres_changes',
					{
						event: 'UPDATE',
						schema: 'public',
						table: 'sessions',
						filter: `id=eq.${sessionId}`
					},
					async (payload) => {
						console.log('[一般検定員/status/realtime] セッション更新を検知:', payload);
						const oldIsActive = payload.old.is_active;
						const newIsActive = payload.new.is_active;
						const oldActivePromptId = payload.old.active_prompt_id;
						const newActivePromptId = payload.new.active_prompt_id;
						console.log('[一般検定員/status/realtime] is_active: old=', oldIsActive, 'new=', newIsActive, 'active_prompt_id: old=', oldActivePromptId, 'new=', newActivePromptId);

						// セッションが終了した場合（true → false の変化）、待機画面（終了画面）に遷移
						if (oldIsActive === true && newIsActive === false) {
							console.log('[一般検定員/status/realtime] 検定終了を検知（true→false） → 終了画面に遷移');
							goto(`/session/${sessionId}?ended=true`);
							return;
						}

						// active_prompt_idがnullになったら、採点が確定された
						if (newActivePromptId === null && oldActivePromptId !== null) {
							console.log('[一般検定員/status/realtime] 採点確定を検知 → 準備画面に遷移');
							goto(`/session/${sessionId}`);
						}
					}
				)
				.subscribe((status) => {
					console.log('[一般検定員/status] Realtimeチャンネルの状態:', status);
					if (status === 'SUBSCRIBED') {
						console.log('[一般検定員/status] ✅ リアルタイム接続成功');
					} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
						console.error('[一般検定員/status] ❌ 接続エラー - 再接続を試みます');
						setTimeout(() => {
							if (realtimeChannel) {
								supabase.removeChannel(realtimeChannel);
							}
							window.location.reload();
						}, 2000);
					}
				});
		}
	});

	onDestroy(() => {
		clearInterval(pollingInterval); // Stop polling for score status
		clearInterval(sessionPollingInterval); // Stop polling for session end
		if (realtimeChannel) {
			supabase.removeChannel(realtimeChannel);
		}
	});

	let canSubmit = false;
	$: canSubmit = (scoreStatus?.scores?.length || 0) >= (scoreStatus?.requiredJudges || 1);

	// 一般検定員：自分の得点が削除されたら採点画面に遷移
	let previousMyScore: any = null;
	let hasInitialized = false;
	$: {
		if (!isChief && scoreStatus?.scores) {
			const profile = get(userProfile);
			const currentUserName = profile?.full_name || data.user?.email || '';
			const myScore = scoreStatus.scores.find((s: any) => s.judge_name === currentUserName);

			// 初回ロード時は自分の得点を記録
			if (!hasInitialized) {
				previousMyScore = myScore;
				hasInitialized = true;
				console.log('[一般検定員/status] 初期化:', { currentUserName, myScore });
			}
			// 前回は自分の得点があったが、今回はない場合 = 修正要求された
			else if (previousMyScore && !myScore) {
				console.log('[一般検定員/status] 修正要求を検知。採点画面に遷移します。');
				// ゼッケン番号をストアに保存してから遷移
				currentBib.set(parseInt(bib || '0'));
				// 参加者IDを取得して遷移
				(async () => {
					const { data: participant } = await supabase
						.from('participants')
						.select('id')
						.eq('session_id', sessionId)
						.eq('bib_number', parseInt(bib || '0'))
						.maybeSingle();

					if (participant) {
						goto(
							`/session/${sessionId}/score/${modeType}/${eventId}/input?bib=${bib}&participantId=${participant.id}`
						);
					}
				})();
			}

			previousMyScore = myScore;
		}
	}
</script>

<Header />

<div class="container">
	<div class="session-info">
		<div class="session-name">{data.sessionDetails.name}</div>
		<div class="event-name">{data.eventInfo?.event_name || data.eventInfo?.name || ''}</div>
	</div>

	<div class="instruction">採点内容の確認</div>

	{#if !data.isTrainingMode}
		<div class="scoring-info">
			<div class="scoring-badge" class:advanced={data.sessionDetails.exclude_extremes}>
				{data.sessionDetails.exclude_extremes ? '5審3採' : '3審3採'}
			</div>
		</div>
	{/if}

	<div class="form-container">
		<div class="current-bib-display">採点対象: <strong>{bib}番</strong></div>
		<h3 class="settings-title">各検定員の得点</h3>
		<div class="participants-container">
			{#if scoreStatus.scores && scoreStatus.scores.length > 0}
				{#each scoreStatus.scores as s}
					<div class="participant-item">
						<div class="participant-info">
							<span class="participant-name">{s.judge_name}</span>
							<span class="score-value">{s.score} 点</span>
						</div>
						{#if isChief}
							<form
								method="POST"
								action="?/requestCorrection"
								use:enhance={({ formData }) => {
									return async ({ result, update }) => {
										await update({ reset: false });
										// 自分自身の修正の場合は採点画面に遷移
										const profile = get(userProfile);
										const currentUserName = profile?.full_name || data.user?.email || '';
										const judgeName = formData.get('judgeName');
										if (result.type === 'success' && judgeName === currentUserName) {
											currentBib.set(parseInt(bib || '0'));
											const { data: participant } = await supabase
												.from('participants')
												.select('id')
												.eq('session_id', sessionId)
												.eq('bib_number', parseInt(bib || '0'))
												.maybeSingle();

											if (participant) {
												goto(
													`/session/${sessionId}/score/${modeType}/${eventId}/input?bib=${bib}&participantId=${participant.id}`
												);
											}
										}
									};
								}}
								style="display: inline;"
							>
								<input type="hidden" name="bib" value={bib} />
								<input type="hidden" name="judgeName" value={s.judge_name} />
								<button type="submit" class="correction-btn">修正</button>
							</form>
						{/if}
					</div>
				{/each}
			{:else}
				<p>採点結果を待っています...</p>
			{/if}
		</div>
	</div>

	<div class="status-message">
		{#if isChief}
			<p>
				現在の採点者数: <strong
					>{scoreStatus.scores?.length || 0} / {scoreStatus.requiredJudges || 1} 人</strong
				>
			</p>
			<form method="POST" action="?/finalizeScore" use:enhance>
				<input type="hidden" name="bib" value={bib} />
				<div class="nav-buttons">
					<NavButton variant="primary" type="submit" disabled={!canSubmit}>
						{canSubmit
							? 'この内容で送信する'
							: `(${scoreStatus.requiredJudges || 1}人の採点が必要です)`}
					</NavButton>
				</div>
			</form>
		{:else}
			<p>主任検定員が内容を確認中です...</p>
		{/if}
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		max-width: 500px;
		margin: 0 auto;
		text-align: center;
	}
	.session-info {
		margin-bottom: 20px;
	}
	.session-name {
		font-size: 14px;
		color: var(--secondary-text);
		margin-bottom: 4px;
	}
	.event-name {
		font-size: 20px;
		font-weight: 600;
		color: var(--primary-text);
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 28px;
	}
	.scoring-info {
		margin-bottom: 20px;
	}
	.scoring-badge {
		display: inline-block;
		background: var(--ios-blue);
		color: white;
		padding: 6px 16px;
		border-radius: 20px;
		font-size: 14px;
		font-weight: 600;
	}
	.scoring-badge.advanced {
		background: #2d7a3e;
	}
	.form-container {
		margin-bottom: 1.5rem;
	}
	.current-bib-display {
		margin-bottom: 20px;
		font-size: 18px;
	}
	.settings-title {
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 0.5rem;
		text-align: left;
	}
	.participants-container {
		background: white;
		border-radius: 12px;
		padding: 8px 16px;
		min-height: 100px;
	}
	.participant-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 0;
		border-bottom: 1px solid var(--separator-gray);
	}
	.participant-item:last-child {
		border-bottom: none;
	}
	.participant-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex: 1;
	}
	.participant-name {
		font-weight: 500;
	}
	.score-value {
		font-size: 18px;
		font-weight: 600;
		color: var(--ios-blue);
		margin-left: auto;
	}
	.correction-btn {
		background: var(--ios-orange);
		color: white;
		border: none;
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.2s;
		margin-left: 16px;
	}
	.correction-btn:active {
		opacity: 0.7;
	}
	.status-message {
		color: var(--secondary-text);
		margin-top: 20px;
	}
	.nav-buttons {
		margin-top: 1rem;
	}
</style>
