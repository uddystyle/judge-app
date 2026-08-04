<script lang="ts">
	import {
		currentSession,
		currentBib,
		currentDiscipline,
		currentLevel,
		currentEvent
	} from '$lib/stores';
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import OfflineReadyCard from '$lib/components/OfflineReadyCard.svelte';
	import { persistGuestIdentity, clearSavedGuestIdentity } from '$lib/offline/guestIdentity';
	import { rependMismatchedMutations } from '$lib/offline/scoreQueue';
	import { syncNow } from '$lib/offline/syncStatus';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { supabase } from '$lib/supabaseClient';
	import type { RealtimeChannelWithRetryHandle } from '$lib/realtime';
	import { createWaitingSessionMonitor } from '$lib/waitingSessionMonitor';
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import * as m from '$lib/paraglide/messages.js';

	// サーバーから渡されたデータを受け取る
	export let data: PageData;
	let realtimeHandle: RealtimeChannelWithRetryHandle | null = null;
	let isPageActive = true; // ページがアクティブかどうかを追跡

	// URLパラメータで終了フラグをチェック（リアクティブに監視）
	// ただし、restart=true パラメータがある場合は終了フラグを無視
	$: isSessionEnded =
		$page.url.searchParams.get('restart') === 'true'
			? false
			: $page.url.searchParams.get('ended') === 'true';

	// URLパラメータから join フラグを取得（リアクティブに監視）
	$: shouldShowJoinUI = $page.url.searchParams.get('join') === 'true';

	// URLパラメータから expired フラグを取得（JWT期限切れ検出）
	$: isSessionExpired = $page.url.searchParams.get('expired') === 'true';

	// 研修モード用の変数
	let selectedUserId: string = '';

	// デバッグ: isSessionEndedの変更を監視
	$: {
		console.log(
			'[DEBUG] isSessionEnded changed:',
			isSessionEnded,
			'isChief:',
			data.isChief,
			'URL:',
			$page.url.href
		);
		console.log('[DEBUG] URL params:', {
			ended: $page.url.searchParams.get('ended'),
			restart: $page.url.searchParams.get('restart'),
			guest: $page.url.searchParams.get('guest')
		});
	}

	// このページが表示されたら、グローバルなストアを更新する
	onMount(async () => {
		currentSession.set(data.sessionDetails);

		// P3: 再認証フロー。認証済みゲストなら identity を端末に控える（クッキー失効後に
		// ?guest= で同一 identity を再採用するため）。あわせて、別 identity で弾かれていた
		// 採点があれば救済して即同期する。通常ユーザーなら古い保存 identity は消す
		// （SIGNED_OUT 時に誤ってゲストへ降格する再採用を防ぐ）。
		const gp = data.guestParticipant;
		const sid = Number(data.sessionDetails.id);
		if (gp?.guest_identifier && gp?.guest_name) {
			// 1026: 復帰の資格情報は resume_token（同席者から読めない）。guest_identifier は
			// owner 列として同席者に見えるため、復帰には使わない。
			persistGuestIdentity(sid, gp.guest_identifier, gp.guest_name, data.guestResumeToken);
			rependMismatchedMutations(gp.guest_identifier)
				.then((n) => {
					if (n > 0) syncNow().catch(() => {});
				})
				.catch(() => {});
		} else if (data.user) {
			clearSavedGuestIdentity(sid);
		}

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
		// 注意: 終了画面でも監視をセットアップすることで、主任検定員がセッションを再開した時に自動的に待機画面に遷移できる
		// 監視不要なのは以下の場合のみ：
		// - ゲストユーザーの参加完了画面（セッションに参加ボタンで待機画面へ）
		const shouldSetupMonitoring =
			!data.isChief && (isSessionEnded || shouldShowJoinUI || !data.guestIdentifier);
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
			realtimeHandle = createWaitingSessionMonitor({
				supabase,
				sessionId,
				initialPromptId: data.sessionDetails.active_prompt_id,
				shouldShowJoinUI,
				identity: {
					guestIdentifier: data.guestIdentifier ?? null,
					userId: data.user?.id ?? null,
					userEmail: data.user?.email ?? null,
					profileName: data.profile?.full_name ?? null
				},
				isPageActive: () => isPageActive,
				isSessionEnded: () => isSessionEnded,
				onSessionEnded: () => {
					isSessionEnded = true;
					realtimeHandle = null;
				},
				onBibChange: (bib) => currentBib.set(bib),
				onNavigate: (url) => goto(url)
			});
		}
	});

	onDestroy(() => {
		console.log('[DEBUG] onDestroy実行 - ページを離れます');
		isPageActive = false; // ページを離れたことを記録
		realtimeHandle?.cleanup();
		realtimeHandle = null;
	});

	function selectDiscipline(discipline: string) {
		// 次のステップ（級選択）のページへ移動
		goto(`/session/${data.sessionDetails.id}/${discipline}`);
	}

	function goToTournamentEvents() {
		goto(`/session/${data.sessionDetails.id}/tournament-events`);
	}

	function goToTournamentSetup() {
		goto(`/session/${data.sessionDetails.id}/tournament-setup`);
	}
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	isGuest={!data.user && !!data.guestIdentifier}
	guestName={data.guestParticipant?.guest_name || null}
/>

<div class="container">
	{#if isSessionExpired}
		<!-- セッション期限切れメッセージ -->
		<div class="alert warning" style="margin-bottom: 24px;">
			<p>
				<strong style="display: inline-flex; align-items: center; gap: 6px;"
					><Icon name="warning" size={18} />セッションの有効期限が切れました</strong
				>
			</p>
			<p>長時間操作がなかったため、セキュリティ上の理由でセッションが終了しました。</p>
			<p>再度参加する場合は、招待リンクまたは参加コードを使用してください。</p>
		</div>
	{/if}

	{#if isSessionEnded}
		<!-- 終了画面（主任・一般共通） -->
		<div class="instruction">
			{data.isTournamentMode
				? `${m.mode_tournament()}終了`
				: data.isTrainingMode
					? `${m.mode_training()}終了`
					: `${m.mode_certification()}終了`}
		</div>
		<div class="end-message">
			<p>
				この{data.isTournamentMode
					? m.mode_tournament()
					: data.isTrainingMode
						? m.mode_training()
						: m.mode_certification()}は終了しました。
			</p>

			{#if !data.isChief && data.isTrainingMode}
				<!-- 研修モード: 主任検定員以外（一般検定員とゲストユーザー）に現在の設定を表示 -->
				<div class="settings-info">
					<p class="settings-label">現在の設定:</p>
					<div
						class="settings-badge"
						class:multi-judge-on={data.isMultiJudge}
						class:multi-judge-off={!data.isMultiJudge}
					>
						{#if data.isMultiJudge}
							複数検定員モード ON
						{:else}
							複数検定員モード OFF（自由採点）
						{/if}
					</div>
				</div>

				{#if data.isMultiJudge && data.guestIdentifier}
					<p class="info-text" style="margin-top: 16px; color: var(--text-secondary);">
						主任検定員がセッションを再開する場合は、<br />下のボタンから再参加できます。
					</p>
				{/if}

				<div class="nav-buttons" style="margin-top: 24px;">
					<!-- 設定変更確認ボタン（主任検定員以外全員に表示） -->
					<NavButton
						on:click={() => {
							// ページをリロードして最新の設定を取得（ended=true を維持）
							const url = data.guestIdentifier
								? `/session/${data.sessionDetails.id}?ended=true`
								: `/session/${data.sessionDetails.id}?ended=true`;
							window.location.href = url;
						}}
					>
						設定の変更を確認
					</NavButton>

					{#if data.guestIdentifier}
						<!-- ゲストユーザー向け：セッション再開ボタン -->
						<NavButton
							variant="primary"
							on:click={() => {
								// 完全にページをリロードして監視を再開
								window.location.href = `/session/${data.sessionDetails.id}?join=true`;
							}}
						>
							セッションに参加
						</NavButton>
					{/if}
				</div>
			{:else if !data.isChief && data.isTournamentMode}
				<!-- 大会モード: 主任検定員以外（一般検定員とゲストユーザー）に採点方式を表示 -->
				<p class="info-text" style="margin-top: 16px;">
					採点方式：{#if data.sessionDetails.exclude_extremes}{m.mode_5judge3score()}（最高点・最低点を除く）{:else}{m.mode_3judge3score()}{/if}
				</p>

				{#if data.guestIdentifier}
					<p class="info-text" style="margin-top: 16px; color: var(--text-secondary);">
						主任検定員がセッションを再開する場合は、<br />下のボタンから再参加できます。
					</p>
				{/if}

				<div class="nav-buttons" style="margin-top: 24px;">
					<!-- 設定変更確認ボタン（主任検定員以外全員に表示） -->
					<NavButton
						on:click={() => {
							// ページをリロードして最新の設定を取得（ended=true を維持）
							const url = data.guestIdentifier
								? `/session/${data.sessionDetails.id}?ended=true`
								: `/session/${data.sessionDetails.id}?ended=true`;
							window.location.href = url;
						}}
					>
						設定の変更を確認
					</NavButton>

					{#if data.guestIdentifier}
						<!-- ゲストユーザー向け：セッション再開ボタン -->
						<NavButton
							variant="primary"
							on:click={() => {
								// 完全にページをリロードして監視を再開
								window.location.href = `/session/${data.sessionDetails.id}?join=true`;
							}}
						>
							セッションに参加
						</NavButton>
					{/if}
				</div>
			{/if}
		</div>
	{:else if data.isChief && data.isTrainingMode}
		<!-- 研修モード: 主任検定員の画面 -->
		{#if data.hasEvents}
			<div class="instruction">{m.mode_training()}モード</div>
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
				<NavButton
					variant="primary"
					on:click={() => {
						goto(`/session/${data.sessionDetails.id}/training-events`);
					}}
				>
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
				<NavButton
					variant="primary"
					on:click={() => goto(`/session/${data.sessionDetails.id}/training-setup`)}
				>
					研修設定へ進む
				</NavButton>
			</div>
		{/if}
	{:else if data.isChief}
		{#if data.isTournamentMode}
			<!-- 大会モード: 種目選択へ -->
			{#if data.hasEvents}
				<div class="instruction">{m.mode_tournament()}モード</div>
				<div class="tournament-info">
					<p>種目選択画面に進んでください</p>
				</div>
				<div class="list-keypad">
					<NavButton variant="primary" on:click={goToTournamentEvents}>種目選択へ進む</NavButton>
					<NavButton on:click={goToTournamentSetup}>大会設定を変更</NavButton>
				</div>
			{:else}
				<div class="instruction">大会設定が必要です</div>
				<div class="tournament-info">
					<p>種目が登録されていません。</p>
					<p>先に種目を設定してください。</p>
				</div>
				<div class="list-keypad">
					<NavButton variant="primary" on:click={goToTournamentSetup}>大会設定へ進む</NavButton>
				</div>
			{/if}
		{:else}
			<!-- 検定モード: 種別選択 -->
			<div class="instruction">種別を選択してください</div>
			<div class="list-keypad">
				{#each data.disciplines ?? [] as discipline}
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
					<Icon name="ready" size={80} />
				</div>
				<div class="instruction">参加完了</div>
				<div class="guest-wait-message">
					<p class="guest-wait-title">セッションへの参加が完了しました</p>
					<p class="guest-wait-subtitle">下のボタンからセッションに参加してください</p>
				</div>
				<!-- すべてのモード共通: セッションに参加ボタン -->
				<div class="guest-action-buttons">
					<NavButton
						variant="primary"
						on:click={() => {
							// ゲストパラメータを保持したままメインセッションページに戻る（待機画面へ遷移）
							window.location.href = `/session/${data.sessionDetails.id}?join=true`;
						}}
					>
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
					<NavButton
						variant="primary"
						on:click={() => {
							goto(`/session/${data.sessionDetails.id}/training-events`);
						}}
					>
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
					<NavButton
						variant="primary"
						on:click={() => goto(`/session/${data.sessionDetails.id}/tournament-events`)}
					>
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
					<Icon name="waiting" size={80} />
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
	{#if !isSessionEnded}
		<OfflineReadyCard
			sessionId={Number(data.sessionDetails.id)}
			guestIdentifier={data.guestIdentifier ?? null}
		/>
	{/if}

	{#if !data.guestIdentifier}
		<div class="nav-buttons">
			<NavButton on:click={() => goto('/dashboard')}>
				{m.session_backToSelection()}
			</NavButton>
		</div>
	{/if}
</div>

<style>
	.alert {
		padding: 16px 20px;
		border-radius: 12px;
		text-align: left;
		line-height: 1.6;
	}

	.alert.warning {
		background-color: rgba(255, 149, 0, 0.1);
		border: 1px solid rgba(255, 149, 0, 0.3);
		color: var(--text-primary);
	}

	.alert p {
		margin: 8px 0;
	}

	.alert p:first-child {
		margin-top: 0;
	}

	.alert p:last-child {
		margin-bottom: 0;
	}

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
		color: var(--ios-blue);
	}

	.waiting-icon :global(svg) {
		animation: spin 2s linear infinite;
	}

	@keyframes spin {
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
		0%,
		100% {
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
		background: var(--bg-secondary);
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
		color: var(--text-secondary);
		border: 1px solid var(--border-medium);
	}

	.settings-badge.multi-judge-off {
		background: transparent;
		color: var(--text-secondary);
		border: 1px solid var(--border-medium);
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
