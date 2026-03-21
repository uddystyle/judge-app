<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import Header from '$lib/components/Header.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import ScoresTable from '$lib/components/ScoresTable.svelte';
	import { enhance } from '$app/forms';
	import { supabase } from '$lib/supabaseClient';
	import { goto } from '$app/navigation';
	import { currentBib, userProfile, currentSession, currentDiscipline, currentLevel, currentEvent } from '$lib/stores';
	import { get } from 'svelte/store';
	import { createScoreStatusManager, type ScoreStatusManagerHandle } from '$lib/scoreStatusManager';
	import { createSessionMonitorChannel, type RealtimeChannelHandle } from '$lib/realtime';

	export let data: PageData;
	let scoreStatus: any = data.initialScoreStatus || { scores: [], requiredJudges: 1 };
	let manager: ScoreStatusManagerHandle | null = null;
	let sessionMonitorHandle: RealtimeChannelHandle | null = null;

	let realtimeConnectionError = false;

	let id: string = '';
	let discipline: string = '';
	let level: string = '';
	let event: string = '';
	let bib: string | null = null;
	let guestIdentifier: string | null = null;

	let isChief = false;
	$: isChief = data.user?.id === data.sessionDetails?.chief_judge_id;

	// 修正成功時のコールバック（自分自身の修正なら採点画面に遷移）
	async function handleCorrectionSuccess(judgeName: string) {
		const profile = get(userProfile);
		const currentUserName = profile?.full_name || data.user?.email || '';

		if (judgeName === currentUserName) {
			currentBib.set(parseInt(bib || '0'));
			goto(`/session/${id}/${discipline}/${level}/${event}/score`);
		}
	}

	// 手動更新
	async function manualRefresh() {
		await manager?.manualRefresh();
	}

	onMount(async () => {
		// URLパラメータを取得
		id = $page.params.id || '';
		discipline = $page.params.discipline || '';
		level = $page.params.level || '';
		event = $page.params.event || '';
		bib = $page.url.searchParams.get('bib');
		guestIdentifier = $page.url.searchParams.get('guest');

		// ヘッダー情報を設定
		if (data.sessionDetails) {
			currentSession.set(data.sessionDetails);
		}
		currentDiscipline.set(discipline);
		currentLevel.set(level);
		currentEvent.set(event);

		// ScoreStatusManager の初期化（大会モード専用、旧ルート）
		if (bib) {
			manager = createScoreStatusManager({
				supabase,
				sessionId: id,
				eventId: '', // 旧ルートは eventId を使わない
				bib,
				isTrainingMode: false,
				totalJudges: data.sessionDetails?.exclude_extremes ? 5 : 3,
				eventInfo: {
					discipline: discipline || '',
					level: level || '',
					event_name: event || ''
				},
				excludeExtremes: data.sessionDetails?.exclude_extremes || false,
				initialStatus: scoreStatus,
				initialAthleteId: null,
				onStatusChange: (s) => { scoreStatus = s; },
				onConnectionError: (e) => { realtimeConnectionError = e; },
			});
			await manager.initializeNameCache();
			manager.setupRealtime();
		}

		// dataから直接判定（リアクティブステートメントに依存しない）
		const currentIsChief = data.user?.id === data.sessionDetails?.chief_judge_id;

		// 一般検定員の場合、セッション状態変更を監視
		// 旧ルートはURL形式が異なるため createSessionMonitorChannel を直接使用
		if (!currentIsChief) {
			sessionMonitorHandle = createSessionMonitorChannel(supabase, {
				sessionId: id,
				channelPrefix: 'session-finalize',
				onPayload: async (payload) => {
					const isActive = payload.new.is_active;
					const activePromptId = payload.new.active_prompt_id;
					const oldActivePromptId = payload.old.active_prompt_id;

					// セッションが終了した場合
					if (isActive === false) {
						goto(`/session/${id}?ended=true`);
						return;
					}

					// 新しいactive_prompt_idが設定された場合（次の滑走者）
					if (activePromptId && activePromptId !== oldActivePromptId) {
						const { data: promptData, error: promptError } = await supabase
							.from('scoring_prompts')
							.select('*')
							.eq('id', activePromptId)
							.single();

						if (!promptError && promptData) {
							currentBib.set(promptData.bib_number);
							goto(`/session/${id}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score`);
							return;
						}
					}

					// active_prompt_idがnullになったら、採点が確定された
					if (activePromptId === null && oldActivePromptId !== null) {
						goto(`/session/${id}`);
					}
				}
			});
		}
	});

	onDestroy(() => {
		manager?.cleanup();
		sessionMonitorHandle?.cleanup();
	});

	let canSubmit = false;
	$: canSubmit = (scoreStatus?.scores?.length || 0) >= (scoreStatus?.requiredJudges || 1);

	// 一般検定員・ゲストユーザー：自分の得点が削除されたら採点画面に遷移
	let previousMyScore: any = null;
	let hasInitialized = false;
	$: {
		if (!isChief && scoreStatus?.scores) {
			const profile = get(userProfile);
			const currentUserName = data.guestParticipant?.guest_name || profile?.full_name || data.user?.email || '';
			const myScore = scoreStatus.scores.find((s: any) => s.judge_name === currentUserName);

			if (!hasInitialized) {
				previousMyScore = myScore;
				hasInitialized = true;
				console.log('[一般検定員/status] 初期化:', { currentUserName, myScore, isGuest: !!data.guestIdentifier });
			}
			else if (previousMyScore && !myScore) {
				console.log('[一般検定員/status] 修正要求を検知。採点画面に遷移します。');
				currentBib.set(parseInt(bib || '0'));
				goto(`/session/${id}/${discipline}/${level}/${event}/score`);
			}

			previousMyScore = myScore;
		}
	}
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	isGuest={!!data.guestIdentifier}
	guestName={data.guestParticipant?.guest_name || null}
/>

<div class="container">
	<div class="instruction">採点内容の確認</div>

	{#if realtimeConnectionError}
		<div class="realtime-error-banner">
			<div class="error-message">
				⚠️ リアルタイム接続エラー - フォールバック更新中（10秒ごと）
			</div>
			<button class="manual-refresh-btn" on:click={manualRefresh}>
				🔄 手動更新・再接続
			</button>
		</div>
	{/if}

	<div class="form-container">
		<div class="current-bib-display">採点対象: <strong>{bib}番</strong></div>
		<ScoresTable
			scores={scoreStatus.scores || []}
			{isChief}
			requiredJudges={scoreStatus.requiredJudges || 1}
			{canSubmit}
			bib={bib || ''}
			actionBase={guestIdentifier ? '' : '?'}
			onCorrectionSuccess={handleCorrectionSuccess}
		/>
	</div>

	<div class="status-message">
		{#if isChief}
			<form
				method="POST"
				action="{guestIdentifier ? `` : '?'}/finalizeScore"
				use:enhance
			>
				<input type="hidden" name="bib" value={bib} />
				<div class="nav-buttons">
					<NavButton
						variant="primary"
						type="submit"
						disabled={!canSubmit}
					>
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
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 28px;
	}
	.form-container {
		margin-bottom: 1.5rem;
	}
	.current-bib-display {
		margin-bottom: 20px;
		font-size: 18px;
	}
	.status-message {
		color: var(--secondary-text);
		margin-top: 20px;
	}
	.nav-buttons {
		margin-top: 1rem;
	}
	/* Realtimeエラー通知のスタイル */
	.realtime-error-banner {
		margin: 16px 0;
		background: #fff3cd;
		border: 1px solid #ffc107;
		border-radius: 8px;
		padding: 12px 16px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.error-message {
		color: #856404;
		font-size: 14px;
		font-weight: 500;
		flex: 1;
	}
	.manual-refresh-btn {
		background: var(--ios-blue);
		color: white;
		border: none;
		border-radius: 6px;
		padding: 8px 16px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition: opacity 0.2s;
	}
	.manual-refresh-btn:active {
		opacity: 0.7;
	}
</style>
