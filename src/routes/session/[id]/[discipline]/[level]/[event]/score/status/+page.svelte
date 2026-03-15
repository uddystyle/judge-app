<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import Header from '$lib/components/Header.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import { enhance } from '$app/forms';
	import { supabase } from '$lib/supabaseClient';
	import { goto } from '$app/navigation';
	import { currentBib, userProfile, currentSession, currentDiscipline, currentLevel, currentEvent } from '$lib/stores';
	import { get } from 'svelte/store';
	import { createRealtimeChannelWithRetry, createSessionMonitorChannel, type RealtimeChannelWithRetryHandle, type RealtimeChannelHandle } from '$lib/realtime';

	export let data: PageData;
	let scoreStatus: any = { scores: [], requiredJudges: 1 };
	let scoreRealtimeHandle: RealtimeChannelWithRetryHandle | null = null;
	let sessionRealtimeHandle: RealtimeChannelHandle | null = null;

	let realtimeConnectionError = false;

	let id: string = '';
	let discipline: string = '';
	let level: string = '';
	let event: string = '';
	let bib: string | null = null;
	let guestIdentifier: string | null = null;

	let isChief = false;
	$: isChief = data.user?.id === data.sessionDetails?.chief_judge_id;

	async function fetchStatus() {
		if (!bib) {
			console.error('❌ Bib number is missing');
			return;
		}

		const guestIdentifier = $page.url.searchParams.get('guest');
		const url = `/api/score-status/${id}/${bib}?discipline=${encodeURIComponent(discipline || '')}&level=${encodeURIComponent(level || '')}&event=${encodeURIComponent(event || '')}`;

		console.log('[fetchStatus] ポーリング中...', { url, isGuest: !!guestIdentifier });
		const response = await fetch(url);

		if (response.ok) {
			const newData = await response.json();
			const judgeNames = newData.scores?.map((s: any) => s.judge_name) || [];
			console.log('[fetchStatus] 新しいデータを取得:', {
				scoreCount: newData.scores?.length,
				judgeNames: judgeNames.join(', ')
			});
			scoreStatus = newData;
		} else {
			const errorText = await response.text();
			console.error('❌ API Error:', response.status, errorText);
		}
	}

	// 手動更新
	async function manualRefresh() {
		scoreRealtimeHandle?.manualRefresh(fetchStatus);
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

		// 初回ロード
		await fetchStatus();

		// Realtime スコア監視のセットアップ（リトライ＋フォールバックポーリング付き）
		if (bib) {
			scoreRealtimeHandle = createRealtimeChannelWithRetry(supabase, {
				channelName: `results-${id}-${bib}`,
				table: 'results',
				filter: `session_id=eq.${id},bib=eq.${parseInt(bib || '0')}`,
				pollingFn: fetchStatus,
				onConnectionError: (hasError) => { realtimeConnectionError = hasError; },
				onPayload: async (payload) => {
					console.log('[status/realtime] スコア変更を検知:', payload);

					// discipline, level, event_nameでフィルタリング（クライアント側）
					let shouldUpdate = false;
					if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
						if (
							payload.new?.discipline === discipline &&
							payload.new?.level === level &&
							payload.new?.event_name === event
						) {
							shouldUpdate = true;
						}
					} else if (payload.eventType === 'DELETE') {
						if (
							payload.old?.discipline === discipline &&
							payload.old?.level === level &&
							payload.old?.event_name === event
						) {
							shouldUpdate = true;
						}
					}

					if (shouldUpdate) {
						console.log('[status/realtime] 該当イベントのスコア変更 - 再取得中...');
						await fetchStatus();
					}
				}
			});
		}

		// dataから直接判定（リアクティブステートメントに依存しない）
		const currentIsChief = data.user?.id === data.sessionDetails?.chief_judge_id;

		// 一般検定員の場合、active_prompt_idがクリアされたら待機画面に遷移
		if (!currentIsChief) {
			sessionRealtimeHandle = createSessionMonitorChannel(supabase, {
				sessionId: id,
				channelPrefix: 'session-finalize',
				onPayload: async (payload) => {
					console.log('[一般検定員/status] セッション更新を検知:', payload);
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
		scoreRealtimeHandle?.cleanup();
		sessionRealtimeHandle?.cleanup();
	});

	let canSubmit = false;
	$: canSubmit = (scoreStatus?.scores?.length || 0) >= (scoreStatus?.requiredJudges || 1);

	// 一般検定員・ゲストユーザー：自分の得点が削除されたら採点画面に遷移
	let previousMyScore: any = null;
	let hasInitialized = false;
	$: {
		if (!isChief && scoreStatus?.scores) {
			const profile = get(userProfile);
			// ゲストユーザーの場合は guest_name、通常ユーザーの場合は full_name または email
			const currentUserName = data.guestParticipant?.guest_name || profile?.full_name || data.user?.email || '';
			const myScore = scoreStatus.scores.find((s: any) => s.judge_name === currentUserName);

			console.log('[一般検定員/status] リアクティブチェック:', {
				currentUserName,
				guestName: data.guestParticipant?.guest_name,
				profileName: profile?.full_name,
				email: data.user?.email,
				myScore,
				previousMyScore,
				hasInitialized,
				allScores: scoreStatus.scores.map((s: any) => s.judge_name)
			});

			// 初回ロード時は自分の得点を記録
			if (!hasInitialized) {
				previousMyScore = myScore;
				hasInitialized = true;
				console.log('[一般検定員/status] 初期化:', { currentUserName, myScore, isGuest: !!data.guestIdentifier });
			}
			// 前回は自分の得点があったが、今回はない場合 = 修正要求された
			else if (previousMyScore && !myScore) {
				console.log('[一般検定員/status] ✅ 修正要求を検知。採点画面に遷移します。');
				// ゼッケン番号をストアに保存してから遷移
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

<!-- <div class="container">
	<div class="instruction">採点内容の確認</div>
	<div class="form-container">
		<div class="current-bib-display">採点対象: <strong>{bib}番</strong></div>
		<h3 class="settings-title">各検定員の得点</h3>
		<div class="participants-container">
			{#if scoreStatus.scores.length > 0}
				{#each scoreStatus.scores as s}
					<div class="participant-item">
						<span class="participant-name">{s.judge_name}</span>
						<span class="score-value">{s.score} 点</span>
					</div>
				{/each}
			{:else}
				<p>採点結果を待っています...</p>
			{/if}
		</div>
	</div>

	<div class="status-message">
		{#if isChief()}
			<p>
				現在の採点者数: <strong
					>{scoreStatus.scores.length} / {scoreStatus.requiredJudges} 人</strong
				>
			</p>
			<div class="nav-buttons">
				<NavButton variant="primary" disabled={!canSubmit()}>
					{canSubmit() ? 'この内容で送信する' : '採点者不足'}
				</NavButton>
			</div>
		{:else}
			<p>主任検定員が内容を確認中です...</p>
		{/if}
	</div>
</div> -->

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
								action="{guestIdentifier ? `` : '?'}/requestCorrection"
								use:enhance={({ formData }) => {
									return async ({ result, update }) => {
										await update({ reset: false });
										// 自分自身の修正の場合は採点画面に遷移
										const profile = get(userProfile);
										const currentUserName = profile?.full_name || data.user?.email || '';
										const judgeName = formData.get('judgeName');
										if (result.type === 'success' && judgeName === currentUserName) {
											currentBib.set(parseInt(bib || '0'));
											goto(`/session/${id}/${discipline}/${level}/${event}/score`);
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
