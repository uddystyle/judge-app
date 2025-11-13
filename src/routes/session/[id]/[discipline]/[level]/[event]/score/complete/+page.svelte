<script lang="ts">
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { currentBib as bibStore } from '$lib/stores';
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { getContext, onMount, onDestroy } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';

	export let data: PageData;

	const supabase = getContext<SupabaseClient>('supabase');

	let endSessionForm: HTMLFormElement;
	let changeEventForm: HTMLFormElement;
	let realtimeChannel: any;
	let pollingInterval: any;
	let previousIsActive: boolean | null = null;

	function handleNextSkier() {
		bibStore.set(null);
		const bibInputPath = $page.url.pathname.replace('/score/complete', '');
		const guestIdentifier = $page.url.searchParams.get('guest');
		const guestParam = guestIdentifier ? `?guest=${guestIdentifier}&join=true` : '';
		goto(`${bibInputPath}${guestParam}`);
	}

	function handleEndSession() {
		// フォームを送信
		if (endSessionForm) {
			endSessionForm.requestSubmit();
		}
	}

	function handleChangeEvent() {
		// フォームを送信
		if (changeEventForm) {
			changeEventForm.requestSubmit();
		}
	}

	onMount(() => {
		// 一般検定員の場合、セッション終了を監視
		if (!data.isChief) {
			const sessionId = $page.params.id;
			const guestIdentifier = $page.url.searchParams.get('guest');
			const guestParam = guestIdentifier ? `&guest=${guestIdentifier}&join=true` : '';

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
						const activePromptId = payload.new.active_prompt_id;
						const oldActivePromptId = payload.old.active_prompt_id;
						console.log('[一般検定員/complete] is_active:', isActive, 'active_prompt_id:', activePromptId, 'old_active_prompt_id:', oldActivePromptId);

						// セッションが終了した場合、待機画面（終了画面）に遷移
						if (isActive === false) {
							console.log('[一般検定員/complete] 検定/大会終了を検知。終了画面に遷移します。');
							goto(`/session/${sessionId}?ended=true${guestParam}`);
						}
						// active_prompt_idがクリアされた場合、待機画面に遷移（種目変更）
						else if (activePromptId === null && oldActivePromptId !== null) {
							console.log('[一般検定員/complete] 種目変更を検知。待機画面に遷移します。');
							goto(`/session/${sessionId}?${guestParam.substring(1)}`);
						}
						// 新しいactive_prompt_idが設定された場合、新しい採点指示を取得して得点入力画面に遷移
						else if (activePromptId && activePromptId !== oldActivePromptId) {
							console.log('[一般検定員/complete] 新しい採点指示を検知:', activePromptId);
							// 新しい指示の詳細をscoring_promptsテーブルから取得
							const { data: promptData, error } = await supabase
								.from('scoring_prompts')
								.select('*')
								.eq('id', activePromptId)
								.single();

							if (error) {
								console.error('[一般検定員/complete] 採点指示の取得に失敗:', error);
								return;
							}

							if (promptData) {
								console.log('[一般検定員/complete] 採点指示の詳細:', promptData);
								// ゼッケン番号をストアに保存
								bibStore.set(promptData.bib_number);
								// 得点入力画面に遷移
								goto(`/session/${sessionId}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score${guestParam}`);
							}
						}
					}
				)
				.subscribe((status) => {
					console.log('[一般検定員/complete] Realtimeチャンネルの状態:', status);
					if (status === 'SUBSCRIBED') {
						console.log('[一般検定員/complete] ✅ リアルタイム接続成功');

						// Realtimeのバックアップとして、3秒ごとにポーリング
						let previousActivePromptId: string | null = null;
						pollingInterval = setInterval(async () => {
							const { data: sessionData, error } = await supabase
								.from('sessions')
								.select('is_active, active_prompt_id')
								.eq('id', sessionId)
								.single();

							if (!error && sessionData) {
								const isActive = sessionData.is_active;
								const activePromptId = sessionData.active_prompt_id;

								// 初回のポーリング
								if (previousIsActive === null) {
									previousIsActive = isActive;
									previousActivePromptId = activePromptId;
									return;
								}

								// セッション終了を検知
								if (isActive === false && previousIsActive === true) {
									console.log('[一般検定員/complete] ✅ 検定終了を検知（ポーリング）');
									goto(`/session/${sessionId}?ended=true${guestParam}`);
									return;
								}

								// 種目変更を検知（active_prompt_idがクリアされた）
								if (activePromptId === null && previousActivePromptId !== null) {
									console.log('[一般検定員/complete] ✅ 種目変更を検知（ポーリング）');
									goto(`/session/${sessionId}?${guestParam.substring(1)}`);
									return;
								}

								// 新しい採点指示を検知
								if (activePromptId && activePromptId !== previousActivePromptId) {
									console.log('[一般検定員/complete] ✅ 新しい採点指示を検知（ポーリング）:', activePromptId);
									// 新しい指示の詳細を取得
									const { data: promptData, error: promptError } = await supabase
										.from('scoring_prompts')
										.select('*')
										.eq('id', activePromptId)
										.single();

									if (!promptError && promptData) {
										console.log('[一般検定員/complete] 採点指示の詳細:', promptData);
										// ゼッケン番号をストアに保存
										bibStore.set(promptData.bib_number);
										goto(`/session/${sessionId}/${promptData.discipline}/${promptData.level}/${promptData.event_name}/score${guestParam}`);
										return;
									}
								}

								previousIsActive = isActive;
								previousActivePromptId = activePromptId;
							}
						}, 3000);
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
		if (pollingInterval) {
			clearInterval(pollingInterval);
		}
	});
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	hasOrganization={data.organizations && data.organizations.length > 0}
	pageOrganizations={data.organizations || []}
	isGuest={!!data.guestIdentifier}
	guestName={data.guestParticipant?.guest_name || null}
/>

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
				<strong>
					{#if data.isTournamentMode}
						{data.averageScore}点
					{:else}
						平均点: {data.averageScore}点
					{/if}
				</strong>
			</div>
		</div>
	{:else}
		<div class="single-score">
			<strong>得点: {data.averageScore}点</strong>
		</div>
	{/if}

	<div class="nav-buttons">
		<NavButton variant="primary" on:click={handleNextSkier}>次の滑走者</NavButton>
		{#if data.isChief || !data.isMultiJudge}
			<NavButton on:click={handleChangeEvent}>種目を変更する</NavButton>
		{/if}
		{#if data.isChief || !data.isMultiJudge}
			<NavButton on:click={handleEndSession}>
				セッションを終了する
			</NavButton>
		{/if}
	</div>

	<!-- 非表示のフォーム -->
	{#if typeof window !== 'undefined'}
		{@const guestParam = new URLSearchParams(window.location.search).get('guest')}
		{@const guestQuery = guestParam ? `&guest=${guestParam}` : ''}
		<form bind:this={endSessionForm} method="POST" action="?/endSession{guestQuery}" use:enhance style="display: none;">
		</form>
		<form
			bind:this={changeEventForm}
			method="POST"
			action="?/changeEvent{guestQuery}"
			use:enhance
			style="display: none;"
		></form>
	{/if}
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
		margin-bottom: 12px;
		text-align: center;
		color: var(--text-primary);
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
	.average-score {
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
			max-width: 500px;
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
		.average-score {
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
