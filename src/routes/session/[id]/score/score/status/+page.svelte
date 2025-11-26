<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import Header from '$lib/components/Header.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import { enhance } from '$app/forms';
	import { supabase } from '$lib/supabaseClient';
	import { goto } from '$app/navigation';

	export let data: PageData;
	let scoreStatus: any = { scores: [], requiredJudges: 1 };
	let pollingInterval: any;
	let realtimeChannel: any;

	let sessionId: string = '';
	let eventId: string = '';
	let bib: string | null = null;

	let isChief = false;
	$: isChief = data.user?.id === data.sessionDetails?.chief_judge_id;

	$: excludeExtremes = data.sessionDetails?.exclude_extremes || false;
	$: requiredJudges = excludeExtremes ? 5 : 3;

	async function fetchStatus() {
		if (!bib) {
			console.error('❌ Bib number is missing');
			return;
		}

		const guestIdentifier = $page.url.searchParams.get('guest');
		const guestParam = guestIdentifier ? `&guest=${encodeURIComponent(guestIdentifier)}` : '';
		const url = `/api/score-status/${sessionId}/${bib}?discipline=${encodeURIComponent(data.customEvent.discipline)}&level=${encodeURIComponent(data.customEvent.level)}&event=${encodeURIComponent(data.customEvent.event_name)}${guestParam}`;

		const response = await fetch(url);

		if (response.ok) {
			const result = await response.json();
			scoreStatus = {
				...result,
				requiredJudges: requiredJudges
			};
		} else {
			const errorText = await response.text();
			console.error('❌ API Error:', response.status, errorText);
		}
	}

	onMount(() => {
		// URLパラメータを取得
		sessionId = $page.params.id || '';
		eventId = $page.params.eventId || '';
		bib = $page.url.searchParams.get('bib');

		fetchStatus();
		pollingInterval = setInterval(fetchStatus, 3000); // Poll every 3 seconds

		// dataから直接判定（リアクティブステートメントに依存しない）
		const currentIsChief = data.user?.id === data.sessionDetails?.chief_judge_id;

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
						console.log('[一般検定員/status] セッション更新を検知:', payload);
						const isActive = payload.new.is_active;
						console.log('[一般検定員/status] is_active:', isActive);

						// セッションが終了した場合、ダッシュボードに遷移
						if (isActive === false) {
							console.log('[一般検定員/status] 検定終了を検知。ダッシュボードに遷移します。');
							goto('/dashboard');
							return;
						}

						// active_prompt_idがnullになったら、採点が確定された
						if (payload.new.active_prompt_id === null && payload.old.active_prompt_id !== null) {
							// 一般検定員は待機画面に戻る（次のゼッケン番号を待つ）
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
		clearInterval(pollingInterval); // Stop polling when leaving the page
		if (realtimeChannel) {
			supabase.removeChannel(realtimeChannel);
		}
	});

	let canSubmit = false;
	$: canSubmit = (scoreStatus?.scores?.length || 0) >= requiredJudges;
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	isGuest={!!data.guestIdentifier}
	guestName={data.guestParticipant?.guest_name || null}
/>

<div class="container">
	<div class="session-info">
		<div class="event-name">{data.customEvent.event_name}</div>
		<div class="scoring-badge" class:advanced={excludeExtremes}>
			{excludeExtremes ? '5審3採' : '3審3採'}
		</div>
	</div>

	<div class="instruction">採点内容の確認</div>

	<div class="form-container">
		<div class="current-bib-display">採点対象: <strong>{bib}番</strong></div>
		<h3 class="settings-title">各検定員の得点</h3>
		<div class="participants-container">
			{#if scoreStatus.scores && scoreStatus.scores.length > 0}
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
		{#if isChief}
			<p>
				現在の採点者数: <strong
					>{scoreStatus.scores?.length || 0} / {requiredJudges} 人</strong
				>
			</p>
			<form method="POST" action="?/finalizeScore" use:enhance>
				<input type="hidden" name="bib" value={bib} />
				<div class="nav-buttons">
					<NavButton variant="primary" type="submit" disabled={!canSubmit}>
						{canSubmit ? 'この内容で送信する' : `(${requiredJudges}人の採点が必要です)`}
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

	.event-name {
		font-size: 20px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 8px;
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

	.instruction {
		font-size: 24px;
		font-weight: 700;
		color: var(--text-primary);
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
	.participant-name {
		font-weight: 500;
	}
	.score-value {
		font-size: 18px;
		font-weight: 600;
		color: var(--ios-blue);
	}
	.status-message {
		color: var(--secondary-text);
		margin-top: 20px;
	}
	.nav-buttons {
		margin-top: 1rem;
	}
</style>
