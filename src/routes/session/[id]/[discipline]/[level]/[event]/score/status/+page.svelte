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

	let id: string = '';
	let discipline: string = '';
	let level: string = '';
	let event: string = '';
	let bib: string | null = null;

	let isChief = false;
	$: isChief = data.user?.id === data.sessionDetails?.chief_judge_id;

	async function fetchStatus() {
		if (!bib) {
			console.error('❌ Bib number is missing');
			return;
		}

		const url = `/api/score-status/${id}/${bib}?discipline=${encodeURIComponent(discipline || '')}&level=${encodeURIComponent(level || '')}&event=${encodeURIComponent(event || '')}`;

		const response = await fetch(url);

		if (response.ok) {
			scoreStatus = await response.json();
		} else {
			const errorText = await response.text();
			console.error('❌ API Error:', response.status, errorText);
		}
	}

	onMount(() => {
		// URLパラメータを取得
		id = $page.params.id || '';
		discipline = $page.params.discipline || '';
		level = $page.params.level || '';
		event = $page.params.event || '';
		bib = $page.url.searchParams.get('bib');

		fetchStatus();
		pollingInterval = setInterval(fetchStatus, 3000); // Poll every 3 seconds

		// dataから直接判定（リアクティブステートメントに依存しない）
		const currentIsChief = data.user?.id === data.sessionDetails?.chief_judge_id;

		// セッション終了検知用のポーリング（主任・一般共通）
		sessionPollingInterval = setInterval(async () => {
			const { data: sessionData, error } = await supabase
				.from('sessions')
				.select('is_active')
				.eq('id', id)
				.single();

			if (!error && sessionData) {
				const isActive = sessionData.is_active;
				if (previousIsActive === null) {
					previousIsActive = isActive;
					return;
				}
				if (previousIsActive !== isActive && isActive === false && previousIsActive === true) {
					console.log('[status] ✅ 検定終了を検知（ポーリング）');
					goto(`/session/${id}?ended=true`);
				}
				previousIsActive = isActive;
			}
		}, 3000);

		// 一般検定員の場合、active_prompt_idがクリアされたら待機画面に遷移
		if (!currentIsChief) {
			console.log('[一般検定員/status] リアルタイムリスナーをセットアップ中...', { id });
			realtimeChannel = supabase
				.channel(`session-finalize-${id}`)
				.on(
					'postgres_changes',
					{
						event: 'UPDATE',
						schema: 'public',
						table: 'sessions',
						filter: `id=eq.${id}`
					},
					async (payload) => {
						console.log('[一般検定員/status] セッション更新を検知:', payload);
						const isActive = payload.new.is_active;
						console.log('[一般検定員/status] is_active:', isActive);

						// セッションが終了した場合、待機画面（終了画面）に遷移
						if (isActive === false) {
							console.log('[一般検定員/status] 検定終了を検知。終了画面に遷移します。');
							goto(`/session/${id}?ended=true`);
							return;
						}

						// active_prompt_idがnullになったら、採点が確定された
						if (payload.new.active_prompt_id === null && payload.old.active_prompt_id !== null) {
							// 一般検定員は待機画面に戻る（次のゼッケン番号を待つ）
							goto(`/session/${id}`);
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
				goto(`/session/${id}/${discipline}/${level}/${event}/score`);
			}

			previousMyScore = myScore;
		}
	}
</script>

<Header />

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
				action="?/finalizeScore"
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
</style>
