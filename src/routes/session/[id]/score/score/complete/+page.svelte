<script lang="ts">
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { supabase } from '$lib/supabaseClient';
	import { onMount, onDestroy } from 'svelte';
	import { currentSession, currentDiscipline, currentEvent, currentBib } from '$lib/stores';

	export let data: PageData;

	let endSessionForm: HTMLFormElement;
	let realtimeChannel: any;

	$: sessionId = $page.params.id;
	$: eventId = $page.params.eventId;
	$: sessionName = data.sessionDetails.name;
	$: eventName = data.customEvent.event_name;
	$: guestIdentifier = data.guestIdentifier;

	function handleNextSkier() {
		goto(`/session/${sessionId}/tournament-events/${eventId}/score`);
	}

	function handleEndSession() {
		// フォームを送信
		if (endSessionForm) {
			endSessionForm.requestSubmit();
		}
	}

	onMount(() => {
		// ヘッダー情報を設定
		currentSession.set({ name: sessionName });
		currentDiscipline.set('大会');
		currentEvent.set(eventName);
		currentBib.set(data.bib);

		// 一般検定員の場合、セッション終了を監視
		if (!data.isChief) {
			console.log('[一般検定員/complete] リアルタイムリスナーをセットアップ中...', { sessionId });
			realtimeChannel = supabase
				.channel(`session-end-${sessionId}`)
				.on(
					'postgres_changes',
					{
						event: 'UPDATE',
						schema: 'public',
						table: 'sessions',
						filter: `id=eq.${sessionId}`
					},
					async (payload) => {
						console.log('[一般検定員/complete] セッション更新を検知:', payload);
						const isActive = payload.new.is_active;
						console.log('[一般検定員/complete] is_active:', isActive);
						// セッションが終了した場合、ダッシュボードに遷移
						if (isActive === false) {
							console.log('[一般検定員/complete] 検定終了を検知。ダッシュボードに遷移します。');
							goto('/dashboard');
						}
					}
				)
				.subscribe((status) => {
					console.log('[一般検定員/complete] Realtimeチャンネルの状態:', status);
					if (status === 'SUBSCRIBED') {
						console.log('[一般検定員/complete] ✅ リアルタイム接続成功');
					} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
						console.error('[一般検定員/complete] ❌ 接続エラー - 再接続を試みます');
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
		if (realtimeChannel) {
			supabase.removeChannel(realtimeChannel);
		}
	});
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	isGuest={false}
	guestName={null}
/>

<div class="container">
	<div class="instruction">送信完了</div>

	<div class="status">
		データが正常に送信されました<br />
		<strong>ゼッケン{data.bib}番</strong>
	</div>

	<div class="scoring-info">
		<div class="scoring-badge" class:advanced={data.excludeExtremes}>
			{data.excludeExtremes ? '5審3採' : '3審3採'}
		</div>
	</div>

	{#if data.scores && data.scores.length > 1}
		<div class="scores-container">
			<h3 class="scores-title">各検定員の得点</h3>
			<div class="scores-list">
				{#each data.scores as score}
					<div class="score-item">
						<span class="judge-name">{score.judge_name}</span>
						<span class="score-value">{score.score}点</span>
					</div>
				{/each}
			</div>
			<div class="total-score">
				<strong>合計点: {data.totalScore}点</strong>
			</div>
		</div>
	{:else}
		<div class="single-score">
			<strong>得点: {data.totalScore}点</strong>
		</div>
	{/if}

	<div class="nav-buttons">
		<NavButton variant="primary" on:click={handleNextSkier}>次の滑走者</NavButton>
		{#if data.isChief || !data.isMultiJudge}
			<NavButton on:click={handleEndSession}>セッションを終了する</NavButton>
		{/if}
	</div>

	<!-- 非表示のフォーム -->
	<form
		bind:this={endSessionForm}
		method="POST"
		action="?/endSession"
		use:enhance
		style="display: none;"
	></form>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 600px;
		margin: 0 auto;
	}

	.instruction {
		font-size: 24px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 28px;
	}

	.status {
		padding: 20px;
		border-radius: 12px;
		margin: 20px auto;
		text-align: center;
		font-size: 16px;
		max-width: 400px;
		background: #e6f6e8;
		border: 2px solid #2d7a3e;
		color: #1e5c2e;
		line-height: 1.6;
	}

	.scoring-info {
		margin-bottom: 20px;
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

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}

	.scores-container {
		max-width: 500px;
		margin: 20px auto;
		text-align: left;
	}

	.scores-title {
		font-size: 18px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 12px;
		text-align: center;
	}

	.scores-list {
		background: var(--bg-primary);
		border-radius: 12px;
		padding: 8px 16px;
		margin-bottom: 16px;
		border: 2px solid var(--border-light);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}

	.score-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 0;
		border-bottom: 1px solid var(--separator-gray);
	}

	.score-item:last-child {
		border-bottom: none;
	}

	.judge-name {
		font-weight: 500;
		color: var(--text-primary);
	}

	.score-value {
		font-size: 18px;
		font-weight: 600;
		color: var(--accent-primary);
	}

	.total-score {
		text-align: center;
		font-size: 20px;
		color: #2d7a3e;
		padding: 16px;
		background: #e6f6e8;
		border-radius: 12px;
		border: 2px solid #2d7a3e;
	}

	.single-score {
		text-align: center;
		font-size: 24px;
		font-weight: 700;
		color: var(--accent-primary);
		margin: 20px 0;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 800px;
		}
		.instruction {
			font-size: 36px;
			margin-bottom: 40px;
		}
		.status {
			padding: 24px;
			font-size: 18px;
		}
		.scores-container {
			max-width: 600px;
		}
		.scores-title {
			font-size: 22px;
		}
		.scores-list {
			padding: 12px 24px;
		}
		.score-item {
			padding: 16px 0;
		}
		.judge-name {
			font-size: 18px;
		}
		.score-value {
			font-size: 22px;
		}
		.total-score {
			font-size: 24px;
			padding: 20px;
		}
		.single-score {
			font-size: 32px;
		}
		.nav-buttons {
			margin-top: 40px;
		}
	}
</style>
