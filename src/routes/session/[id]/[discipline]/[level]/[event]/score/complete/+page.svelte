<script lang="ts">
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { currentBib as bibStore } from '$lib/stores';
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { supabase } from '$lib/supabaseClient';
	import { onMount, onDestroy } from 'svelte';

	export let data: PageData;

	let endSessionForm: HTMLFormElement;
	let realtimeChannel: any;

	function handleNextSkier() {
		bibStore.set(null);
		const bibInputPath = $page.url.pathname.replace('/score/complete', '');
		goto(bibInputPath);
	}

	function handleEndSession() {
		// フォームを送信
		if (endSessionForm) {
			endSessionForm.requestSubmit();
		}
	}

	onMount(() => {
		// 一般検定員の場合、セッション終了を監視
		if (!data.isChief) {
			const sessionId = $page.params.id;
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

<Header />

<div class="container">
	<div class="instruction">送信完了</div>
	<div class="status">
		データが正常に送信されました<br />
		<strong>ゼッケン{data.bib}番</strong>
	</div>

	{#if data.isMultiJudge && data.scores.length > 1}
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
			<div class="average-score">
				<strong>平均点: {data.averageScore}点</strong>
			</div>
		</div>
	{:else}
		<div class="single-score">
			<strong>得点: {data.averageScore}点</strong>
		</div>
	{/if}

	<div class="nav-buttons">
		<NavButton variant="primary" on:click={handleNextSkier}>次の滑走者</NavButton>
		<NavButton>結果を共有</NavButton>
		{#if data.isChief}
			<NavButton on:click={handleEndSession}>検定を終了</NavButton>
		{/if}
	</div>

	<!-- 非表示のフォーム -->
	<form bind:this={endSessionForm} method="POST" action="?/endSession" use:enhance style="display: none;">
	</form>
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
	.status {
		padding: 15px;
		border-radius: 12px;
		margin: 20px auto;
		text-align: center;
		font-size: 15px;
		max-width: 340px;
		background: #e6f6e8;
		border: 1px solid var(--ios-green);
		color: #1e5c2e;
		line-height: 1.6;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.scores-container {
		max-width: 400px;
		margin: 20px auto;
		text-align: left;
	}
	.scores-title {
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 12px;
		text-align: center;
	}
	.scores-list {
		background: white;
		border-radius: 12px;
		padding: 8px 16px;
		margin-bottom: 16px;
		border: 1px solid var(--separator-gray);
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
		color: var(--primary-text);
	}
	.score-value {
		font-size: 18px;
		font-weight: 600;
		color: var(--ios-blue);
	}
	.average-score {
		text-align: center;
		font-size: 20px;
		color: var(--ios-green);
		padding: 12px;
		background: #e6f6e8;
		border-radius: 12px;
		border: 1px solid var(--ios-green);
	}
	.single-score {
		text-align: center;
		font-size: 20px;
		color: var(--ios-blue);
		margin: 20px 0;
	}
</style>
