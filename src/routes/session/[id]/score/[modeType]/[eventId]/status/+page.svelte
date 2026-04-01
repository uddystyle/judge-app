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
	import { currentBib, userProfile, currentSession, currentDiscipline, currentEvent } from '$lib/stores';
	import { get } from 'svelte/store';
	import { createScoreStatusManager, type ScoreStatusManagerHandle } from '$lib/scoreStatusManager';
	import { createSessionNavigationMonitor } from '$lib/sessionNavigationMonitor';
	import type { RealtimeChannelHandle } from '$lib/realtime';
	import * as m from '$lib/paraglide/messages.js';

	export let data: PageData;
	let scoreStatus: any = data.initialScoreStatus || { scores: [], requiredJudges: 1 };
	let realtimeConnectionError = false;
	let manager: ScoreStatusManagerHandle | null = null;
	let sessionMonitorHandle: RealtimeChannelHandle | null = null;

	let sessionId: string = '';
	let modeType: string = '';
	let eventId: string = '';
	let bib: string | null = null;

	let isChief = false;
	$: isChief = data.user?.id === data.sessionDetails?.chief_judge_id;
	$: guestIdentifier = data.guestIdentifier;
	$: guestParticipant = data.guestParticipant;

	// 手動更新
	async function manualRefresh() {
		await manager?.manualRefresh();
	}

	onMount(async () => {
		sessionId = $page.params.id || '';
		modeType = $page.params.modeType || '';
		eventId = $page.params.eventId || '';
		bib = $page.url.searchParams.get('bib');

		console.log('[status/onMount] data:', data);
		console.log('[status/onMount] params:', { sessionId, modeType, eventId, bib });
		console.log('[status/onMount] totalJudges:', data.totalJudges, 'isTrainingMode:', data.isTrainingMode, 'isMultiJudge:', data.isMultiJudge);

		// ヘッダー情報を設定
		currentSession.set({ name: data.sessionDetails?.name || '' });
		currentDiscipline.set(data.isTrainingMode ? m.mode_training() : m.mode_tournament());
		currentEvent.set(data.eventInfo?.name || data.eventInfo?.event_name || '');
		currentBib.set(bib ? parseInt(bib) : null);

		manager = createScoreStatusManager({
			supabase,
			sessionId,
			eventId,
			bib: bib || '',
			isTrainingMode: data.isTrainingMode,
			totalJudges: data.totalJudges || 1,
			eventInfo: data.eventInfo,
			excludeExtremes: data.sessionDetails?.exclude_extremes || false,
			initialStatus: scoreStatus,
			initialAthleteId: data.athleteId || null,
			onStatusChange: (s) => { scoreStatus = s; },
			onConnectionError: (e) => { realtimeConnectionError = e; },
		});
		await manager.initializeNameCache();
		manager.setupRealtime();

		// dataから直接判定（リアクティブステートメントに依存しない）
		const currentIsChief = data.user?.id === data.sessionDetails?.chief_judge_id;

		if (!currentIsChief) {
			sessionMonitorHandle = createSessionNavigationMonitor({
				supabase,
				sessionId,
				modeType,
				eventId,
				onNavigate: (url) => goto(url),
				onBibChange: (b) => currentBib.set(b),
			});
		}
	});

	onDestroy(() => {
		manager?.cleanup();
		sessionMonitorHandle?.cleanup();
	});

	// 修正成功時のコールバック（自分自身の修正なら採点画面に遷移）
	async function handleCorrectionSuccess(judgeName: string) {
		let currentUserName = '';
		if (guestParticipant) {
			currentUserName = guestParticipant.guest_name;
		} else {
			const profile = get(userProfile);
			currentUserName = profile?.full_name || data.user?.email || '';
		}

		if (judgeName === currentUserName) {
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
	}

	// 点差を計算する関数（整数）
	function calculateScoreDiff(scores: any[]): number | null {
		if (!scores || scores.length === 0) return null;

		const scoreValues = scores.map((s) => parseFloat(s.score));
		const maxScore = Math.max(...scoreValues);
		const minScore = Math.min(...scoreValues);

		return Math.round(maxScore - minScore);
	}

	// 点差チェック
	let scoreDiff: number | null = null;
	let scoreDiffExceeded: boolean = false;

	$: isTournamentMode = !data.isTrainingMode && (data.isTournamentMode || modeType === 'tournament' || data.sessionDetails?.is_tournament_mode || data.sessionDetails?.mode === 'tournament');

	$: {
		if (isTournamentMode && scoreStatus?.scores && scoreStatus.scores.length > 0) {
			scoreDiff = calculateScoreDiff(scoreStatus.scores);

			const maxAllowedDiff = data.sessionDetails?.max_score_diff;
			if (maxAllowedDiff !== null && maxAllowedDiff !== undefined && scoreDiff !== null) {
				scoreDiffExceeded = scoreDiff > maxAllowedDiff;
			} else {
				scoreDiffExceeded = false;
			}
		} else {
			scoreDiff = null;
			scoreDiffExceeded = false;
		}
	}

	let canSubmit = false;
	$: {
		const hasRequiredScores = (scoreStatus?.scores?.length || 0) >= (scoreStatus?.requiredJudges || 1);
		const scoreDiffOk = !scoreDiffExceeded;

		canSubmit = hasRequiredScores && scoreDiffOk;
	}

	// 一般検定員：自分の得点が削除されたら採点画面に遷移
	let previousMyScore: any = null;
	let hasInitialized = false;
	$: {
		if (!isChief && scoreStatus?.scores) {
			let currentUserName = '';
			if (guestParticipant) {
				currentUserName = guestParticipant.guest_name;
			} else {
				const profile = get(userProfile);
				currentUserName = profile?.full_name || data.user?.email || '';
			}
			const myScore = scoreStatus.scores.find((s: any) => s.judge_name === currentUserName);

			if (!hasInitialized) {
				previousMyScore = myScore;
				hasInitialized = true;
				console.log('[一般検定員/status] 初期化:', { currentUserName, myScore });
			}
			else if (previousMyScore && !myScore) {
				console.log('[一般検定員/status] 修正要求を検知。採点画面に遷移します。');
				currentBib.set(parseInt(bib || '0'));
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

	{#if !data.isTrainingMode}
		<div class="scoring-info">
			<div class="scoring-badge" class:advanced={data.sessionDetails.exclude_extremes}>
				{data.sessionDetails.exclude_extremes ? '5審3採' : '3審3採'}
			</div>
			{#if data.sessionDetails?.max_score_diff !== null && data.sessionDetails?.max_score_diff !== undefined}
				<div class="score-diff-badge">
					点差制限: {data.sessionDetails.max_score_diff}点
				</div>
			{/if}
		</div>
	{/if}

	<div class="form-container">
		<div class="current-bib-display">採点対象: <strong>{bib}番</strong></div>
		<ScoresTable
			scores={scoreStatus.scores || []}
			{isChief}
			requiredJudges={scoreStatus.requiredJudges || 1}
			{canSubmit}
			highlightExtremes={isTournamentMode}
			bib={bib || ''}
			actionBase={guestIdentifier ? '' : '?'}
			onCorrectionSuccess={handleCorrectionSuccess}
		/>
	</div>

	<!-- 点差制限の警告（大会モードのみ） -->
	{#if isTournamentMode && isChief && scoreDiffExceeded}
		<div class="score-diff-warning">
			点差が上限を超えています。<br />検定員に再採点を指示してください。
		</div>
	{/if}

	<div class="status-message">
		{#if isChief}
			<form method="POST" action="{guestIdentifier ? `` : '?'}/finalizeScore" use:enhance>
				<input type="hidden" name="bib" value={bib} />
				<div class="nav-buttons">
					<NavButton variant="primary" type="submit" disabled={!canSubmit}>
						{#if (scoreStatus?.scores?.length || 0) < (scoreStatus?.requiredJudges || 1)}
							({scoreStatus.requiredJudges || 1}人の採点が必要です)
						{:else}
							この内容で送信する
						{/if}
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
	.scoring-info {
		margin-bottom: 20px;
		display: flex;
		gap: 10px;
		justify-content: center;
		align-items: center;
		flex-wrap: wrap;
	}
	.scoring-badge {
		display: inline-block;
		background: transparent;
		color: #6b7280;
		padding: 4px 12px;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.01em;
	}
	.scoring-badge.advanced {
		color: #6b7280;
		border-color: #d1d5db;
	}
	.score-diff-badge {
		display: inline-block;
		background: transparent;
		color: #6b7280;
		padding: 4px 12px;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.01em;
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
	/* 点差制限警告のスタイル */
	.score-diff-warning {
		margin-top: 20px;
		background: var(--ios-orange);
		color: white;
		padding: 16px;
		border-radius: 12px;
		font-size: 15px;
		font-weight: 600;
		text-align: center;
		line-height: 1.6;
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
