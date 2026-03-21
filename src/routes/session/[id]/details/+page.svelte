<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import * as XLSX from 'xlsx';
	import QRInviteModal from '$lib/components/QRInviteModal.svelte';
	import EventManagement from '$lib/components/EventManagement.svelte';
	import TournamentSettings from '$lib/components/TournamentSettings.svelte';
	import MultiJudgeSettings from '$lib/components/MultiJudgeSettings.svelte';
	import { onMount } from 'svelte';

	export let data: PageData;
	export let form: ActionData;

	$: sessionName = data.sessionDetails.name;
	$: participantCount = data.participants?.length || 0;

	// セッション名編集用の状態
	let isEditingName = false;
	let editedName = data.sessionDetails.name;
	let isSubmittingName = false;
	const isCreator = data.currentUserId === data.sessionDetails.created_by;

	// アラートダイアログの状態
	let showAlert = false;
	let alertMessage = '';
	let alertTitle = 'エラー';

	function startEditingName() {
		if (!isCreator) return;
		isEditingName = true;
		editedName = data.sessionDetails.name;
	}

	function cancelEditingName() {
		isEditingName = false;
		editedName = data.sessionDetails.name;
	}

	let exportLoading = false;
	let deleteDataForm: HTMLFormElement;
	let deleteCertificationDataForm: HTMLFormElement;

	// ゲストユーザー削除確認ダイアログ
	let showRemoveGuestDialog = false;
	let guestToRemove: { identifier: string; name: string } | null = null;
	let removeGuestForms: { [key: string]: HTMLFormElement } = {};

	// 一般検定員削除確認ダイアログ
	let showRemoveParticipantDialog = false;
	let participantToRemove: { userId: string; name: string } | null = null;
	let removeParticipantForms: { [key: string]: HTMLFormElement } = {};

	// 参加コードコピー機能
	let copiedCode = false;

	function copyJoinCode() {
		navigator.clipboard.writeText(data.sessionDetails.join_code).then(
			() => {
				copiedCode = true;
				setTimeout(() => {
					copiedCode = false;
				}, 2000);
			},
			(err) => {
				console.error('コピーに失敗しました:', err);
				alert('コピーに失敗しました。');
			}
		);
	}

	function openRemoveGuestDialog(guestIdentifier: string, guestName: string) {
		guestToRemove = { identifier: guestIdentifier, name: guestName };
		showRemoveGuestDialog = true;
	}

	function handleRemoveGuestConfirm() {
		if (guestToRemove && removeGuestForms[guestToRemove.identifier]) {
			removeGuestForms[guestToRemove.identifier].requestSubmit();
		}
		showRemoveGuestDialog = false;
		guestToRemove = null;
	}

	function handleRemoveGuestCancel() {
		showRemoveGuestDialog = false;
		guestToRemove = null;
	}

	function openRemoveParticipantDialog(userId: string, participantName: string) {
		participantToRemove = { userId, name: participantName };
		showRemoveParticipantDialog = true;
	}

	function handleRemoveParticipantConfirm() {
		if (participantToRemove && removeParticipantForms[participantToRemove.userId]) {
			removeParticipantForms[participantToRemove.userId].requestSubmit();
		}
		showRemoveParticipantDialog = false;
		participantToRemove = null;
	}

	function handleRemoveParticipantCancel() {
		showRemoveParticipantDialog = false;
		participantToRemove = null;
	}

	// 参加者リスト更新
	let isRefreshing = false;
	function handleRefresh() {
		isRefreshing = true;
		window.location.reload();
	}

	// QRコード関連
	let showQRModal = false;
	let inviteUrl = '';
	let copiedInviteUrl = false;

	onMount(() => {
		// 招待URLを生成
		const baseUrl = window.location.origin;
		inviteUrl = `${baseUrl}/session/invite/${data.sessionDetails.invite_token}`;
	});

	function openQRModal() {
		showQRModal = true;
	}

	function closeQRModal() {
		showQRModal = false;
	}

	function copyInviteUrl() {
		navigator.clipboard.writeText(inviteUrl).then(
			() => {
				copiedInviteUrl = true;
				setTimeout(() => {
					copiedInviteUrl = false;
				}, 2000);
			},
			(err) => {
				console.error('コピーに失敗しました:', err);
				alertMessage = 'URLのコピーに失敗しました。';
				showAlert = true;
			}
		);
	}

	async function handleExport() {
		exportLoading = true;
		try {
			// 1. Fetch data from our new server endpoint
			const response = await fetch(`/api/export/${data.sessionDetails.id}`);
			const jsonData = await response.json();

			if (!response.ok || !jsonData.results || jsonData.results.length === 0) {
				alertMessage = 'エクスポートするデータがありません。';
				showAlert = true;
				return;
			}

			// 2. Prepare the data for the Excel sheet
			const exportData = jsonData.results.map((item: any) => ({
				採点日時: new Date(item.created_at).toLocaleString('ja-JP'),
				ゼッケン: item.bib,
				得点: item.score,
				種別: item.discipline,
				級: item.level,
				種目: item.event_name,
				検定員: item.judge_name
			}));

			// 3. Create the Excel file in the browser
			const worksheet = XLSX.utils.json_to_sheet(exportData);
			const workbook = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(workbook, worksheet, '採点結果');

			const fileName = `${data.sessionDetails.name}_採点結果.xlsx`;

			// 4. モバイル環境かどうかを判定（Web Share API対応 & 画面幅768px未満）
			const isMobile = window.innerWidth < 768;
			const canShare = navigator.share !== undefined;

			if (isMobile && canShare) {
				// モバイル環境: Web Share APIで共有
				const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
				const blob = new Blob([excelBuffer], {
					type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
				});
				const file = new File([blob], fileName, {
					type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
				});

				await navigator.share({
					title: '採点結果',
					text: `${data.sessionDetails.name}の採点結果`,
					files: [file]
				});
			} else {
				// PC環境: ダウンロード
				XLSX.writeFile(workbook, fileName);
			}
		} catch (err) {
			console.error('Export failed:', err);
			alertMessage = 'エクスポート処理中にエラーが発生しました。';
			showAlert = true;
		} finally {
			exportLoading = false;
		}
	}
</script>

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} hasOrganization={data.hasOrganization} />

<div class="container">
	<!-- セッション名ヘッダー -->
	<div class="session-header">
		{#if form?.success}
			<div class="success-notification">{form.message}</div>
		{/if}
		{#if form?.error}
			<div class="error-notification">{form.error}</div>
		{/if}

		{#if isEditingName}
			<!-- 編集モード -->
			<form
				method="POST"
				action="?/updateName"
				class="name-edit-form"
				use:enhance={() => {
					isSubmittingName = true;
					return async ({ update, result }) => {
						await update();
						isSubmittingName = false;
						if (result.type === 'success') {
							isEditingName = false;
							// ストアを更新
							data.sessionDetails.name = editedName;
						}
					};
				}}
			>
				<input
					type="text"
					name="name"
					bind:value={editedName}
					class="name-input"
					placeholder="セッション名を入力"
					required
					maxlength="200"
					disabled={isSubmittingName}
				/>
				<div class="name-edit-buttons">
					<button type="submit" class="save-btn" disabled={isSubmittingName}>
						{isSubmittingName ? '保存中...' : '保存'}
					</button>
					<button type="button" class="cancel-btn" on:click={cancelEditingName} disabled={isSubmittingName}>
						キャンセル
					</button>
				</div>
			</form>
		{:else}
			<!-- 表示モード -->
			<div class="name-display">
				<h1 class="session-title">{data.sessionDetails.name}</h1>
				{#if isCreator}
					<button class="edit-name-btn" on:click={startEditingName} title="セッション名を編集">
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
							<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
						</svg>
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<!-- ユーザーを招待セクション -->
	<div class="settings-section">
		<h3 class="settings-title">ユーザーを招待</h3>
		<div class="invite-container">
			<div class="invite-item">
				<span class="invite-label">参加コード</span>
				<div class="code-display">
					<input type="text" value={data.sessionDetails.join_code} readonly class="code-input" />
					<button class="copy-btn" on:click={copyJoinCode}>
						{#if copiedCode}
							✓ コピー済
						{:else}
							コピー
						{/if}
					</button>
				</div>
			</div>
			<p class="invite-note">※ ログイン済みのユーザーが<br class="mobile-break" />このコードを使用してセッションに参加できます</p>
		</div>
	</div>

	<!-- ゲスト招待セクション -->
	<div class="settings-section">
		<h3 class="settings-title">ゲストを招待</h3>
		<div class="invite-container">
			<div class="invite-item">
				<span class="invite-label">招待URL</span>
				<div class="url-display">
					<input type="text" value={inviteUrl} readonly class="url-input" />
					<button class="copy-btn" on:click={copyInviteUrl}>
						{copiedInviteUrl ? '✓ コピー済' : 'コピー'}
					</button>
				</div>
			</div>

			<div class="invite-item">
				<span class="invite-label">QRコード</span>
				<button class="qr-btn" on:click={openQRModal}>
					QRコードを表示
				</button>
			</div>

			<p class="invite-note">※ アカウント登録不要で参加できます</p>
		</div>
	</div>

	<hr class="divider" />

	<div class="settings-section">
		<div class="section-header-with-action">
			<h3 class="settings-title">参加中の検定員</h3>
			<button class="refresh-btn-with-label" class:refreshing={isRefreshing} on:click={handleRefresh} title="参加者リストを更新">
				<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
				</svg>
				<span class="refresh-label">リストを更新</span>
			</button>
		</div>
		<div class="participants-container">
			{#if data.participants && data.participants.length > 0}
				{#each data.participants as p}
					<div class="participant-item" class:removed={p.removed_at}>
						<span class="participant-name">
							{#if p.is_guest}
								{p.guest_name}
								<span class="guest-badge">(ゲスト)</span>
							{:else}
								{p.profiles?.full_name || 'プロフィール未設定'}
								{#if data.sessionDetails.chief_judge_id === p.user_id}
									<span class="chief-badge">(主任)</span>
								{/if}
								{#if p.removed_at}
									<span class="removed-badge">(退会済み)</span>
								{/if}
							{/if}
						</span>

						<div class="participant-actions">
							{#if !p.is_guest && data.currentUserId === data.sessionDetails.created_by}
								<form method="POST" action="?/appointChief" use:enhance>
									<input type="hidden" name="userId" value={p.user_id} />
									<button
										type="submit"
										class="appoint-btn"
									>
										{#if data.sessionDetails.chief_judge_id === p.user_id}
											主任を解除
										{:else}
											主任に任命
										{/if}
									</button>
								</form>

								{#if p.user_id !== data.currentUserId && p.user_id !== data.sessionDetails.chief_judge_id}
									<form
										bind:this={removeParticipantForms[p.user_id]}
										method="POST"
										action="?/removeParticipant"
										use:enhance
									>
										<input type="hidden" name="userId" value={p.user_id} />
										<button
											type="button"
											class="appoint-btn danger"
											on:click={() => openRemoveParticipantDialog(p.user_id, p.profiles?.full_name || 'プロフィール未設定')}
										>
											削除
										</button>
									</form>
								{/if}
							{/if}

							{#if p.is_guest && data.currentUserId === data.sessionDetails.created_by}
								<form
									bind:this={removeGuestForms[p.guest_identifier]}
									method="POST"
									action="?/removeGuest"
									use:enhance
								>
									<input type="hidden" name="guestIdentifier" value={p.guest_identifier} />
									<button
										type="button"
										class="appoint-btn danger"
										on:click={() => openRemoveGuestDialog(p.guest_identifier, p.guest_name)}
									>
										削除
									</button>
								</form>
							{/if}
						</div>
					</div>
				{/each}
			{:else}
				<p>参加者はいません。</p>
			{/if}
		</div>
	</div>

	<hr class="divider" />

	<!-- 種目管理セクション（大会・研修モードのみ） -->
	{#if data.isTournamentMode || data.isTrainingMode}
		<EventManagement
			events={data.events}
			isTrainingMode={data.isTrainingMode}
			isChief={data.currentUserId === data.sessionDetails.chief_judge_id}
			eventSuccess={form?.eventSuccess}
			eventError={form?.eventError}
		/>
		<hr class="divider" />
	{/if}

	{#if data.sessionDetails.is_tournament_mode}
		<TournamentSettings
			isChief={data.currentUserId === data.sessionDetails.chief_judge_id}
			{participantCount}
			initialExcludeExtremes={data.sessionDetails.exclude_extremes}
			initialMaxScoreDiff={data.sessionDetails.max_score_diff}
			tournamentSettingsSuccess={form?.tournamentSettingsSuccess}
			tournamentSettingsError={form?.tournamentSettingsError}
		/>
		<hr class="divider" />
	{:else if data.isTrainingMode}
		<MultiJudgeSettings
			mode="training"
			isChief={data.currentUserId === data.sessionDetails.chief_judge_id}
			isMultiJudge={data.trainingSession?.is_multi_judge || false}
			settingsSuccess={form?.trainingSettingsSuccess}
			settingsError={form?.trainingSettingsError}
		/>
		<hr class="divider" />
	{:else}
		<MultiJudgeSettings
			mode="certification"
			isChief={data.currentUserId === data.sessionDetails.chief_judge_id}
			isMultiJudge={data.sessionDetails.is_multi_judge}
			requiredJudges={data.sessionDetails.required_judges}
			{participantCount}
			settingsSuccess={form?.settingsSuccess}
			settingsError={form?.settingsError}
		/>
		<hr class="divider" />
	{/if}

	<!-- 研修モード: スコアボード表示 -->
	{#if data.isTrainingMode && data.trainingScores && data.trainingScores.length > 0}
		<div class="settings-section">
			<h3 class="settings-title">採点結果</h3>
			<div class="scoreboard">
				<div class="scoreboard-header">
					<div class="col-event">種目</div>
					<div class="col-athlete">選手</div>
					<div class="col-judge">検定員</div>
					<div class="col-score">得点</div>
				</div>
				{#each data.trainingScores as score}
					<div class="scoreboard-row">
						<div class="col-event">{score.training_events?.name || '-'}</div>
						<div class="col-athlete">
							#{score.athlete?.bib_number || '-'}
							{#if score.athlete?.profiles?.full_name}
								<span class="athlete-name">{score.athlete.profiles.full_name}</span>
							{/if}
						</div>
						<div class="col-judge">
							{score.judge?.full_name || '-'}
						</div>
						<div class="col-score">{score.score}点</div>
					</div>
				{/each}
			</div>
		</div>
		<hr class="divider" />
	{/if}

	{#if data.sessionDetails.is_tournament_mode || data.currentUserId === data.sessionDetails.created_by}
		<div class="settings-section">
			<h3 class="settings-title">データ管理</h3>
			<div class="nav-buttons">
				{#if data.sessionDetails.is_tournament_mode}
					<NavButton
						variant="primary"
						on:click={() => goto(`/session/${data.sessionDetails.id}/scoreboard`)}
					>
						スコアボードを表示
					</NavButton>
				{/if}
				{#if data.currentUserId === data.sessionDetails.created_by}
					<NavButton on:click={handleExport} disabled={exportLoading}>
						{exportLoading ? '準備中...' : '採点結果をエクスポート'}
					</NavButton>
					{#if data.isTrainingMode}
						<NavButton
							variant="danger"
							on:click={() => {
								console.log('[UI] 採点データ削除ボタンがクリックされました');
								if (confirm('研修モードの採点データを全て削除します。この操作は取り消せません。\n\n本当に削除しますか？')) {
									console.log('[UI] 削除が確認されました。フォームを送信します...');
									if (deleteDataForm) {
										console.log('[UI] フォーム要素:', deleteDataForm);
										deleteDataForm.requestSubmit();
									} else {
										console.error('[UI] ❌ フォーム要素が見つかりません');
									}
								} else {
									console.log('[UI] 削除がキャンセルされました');
								}
							}}
						>
							採点データを削除
						</NavButton>
					{:else if !data.sessionDetails.is_tournament_mode}
						<NavButton
							variant="danger"
							on:click={() => {
								if (confirm('検定モードの採点データを全て削除します。この操作は取り消せません。\n\n本当に削除しますか？')) {
									if (deleteCertificationDataForm) {
										deleteCertificationDataForm.requestSubmit();
									}
								}
							}}
						>
							採点データを削除
						</NavButton>
					{/if}
				{/if}
			</div>
		</div>

		<hr class="divider" />
	{/if}

	<div class="nav-buttons">
		<NavButton on:click={() => goto('/dashboard')}>
			セッション選択画面に戻る
		</NavButton>
	</div>

	{#if data.currentUserId === data.sessionDetails.created_by}
		<div class="nav-buttons">
			<NavButton
				variant="danger"
				on:click={() => goto(`/session/${data.sessionDetails.id}/details/delete`)}
			>
				この{data.isTrainingMode ? '研修' : data.sessionDetails.is_tournament_mode ? '大会' : '検定'}を削除
			</NavButton>
		</div>
	{/if}
</div>

<!-- QRコードモーダル -->
<QRInviteModal {inviteUrl} sessionName={data.sessionDetails.name} show={showQRModal} on:close={closeQRModal} />

<!-- 非表示フォーム: 採点データ削除 -->
<form
	bind:this={deleteDataForm}
	method="POST"
	action="?/deleteTrainingData"
	use:enhance={() => {
		console.log('[UI/enhance] フォーム送信が開始されました');
		return async ({ result, update }) => {
			console.log('[UI/enhance] サーバーからのレスポンス:', result);
			if (result.type === 'success') {
				console.log('[UI/enhance] ✅ 削除成功。ページをリロードします...');
				await update();
				window.location.reload();
			} else if (result.type === 'failure') {
				console.error('[UI/enhance] ❌ 削除失敗:', result.data);
				await update();
				if (result.data?.error) {
					alert(`エラー: ${result.data.error}`);
				}
			} else {
				console.log('[UI/enhance] その他の結果:', result.type);
				await update();
			}
		};
	}}
	style="display: none;"
></form>

<!-- 非表示フォーム: 検定モード採点データ削除 -->
<form
	bind:this={deleteCertificationDataForm}
	method="POST"
	action="?/deleteCertificationData"
	use:enhance={() => {
		return async ({ result, update }) => {
			if (result.type === 'success') {
				await update();
				window.location.reload();
			} else if (result.type === 'failure') {
				await update();
				if (result.data?.error) {
					alert(`エラー: ${result.data.error}`);
				}
			} else {
				await update();
			}
		};
	}}
	style="display: none;"
></form>

<!-- ゲストユーザー削除確認ダイアログ -->
<ConfirmDialog
	bind:isOpen={showRemoveGuestDialog}
	title="ゲストユーザーを削除"
	message={guestToRemove ? `ゲストユーザー「${guestToRemove.name}」をセッションから削除しますか？\n\nこの操作は取り消せません。` : ''}
	confirmText="削除"
	cancelText="キャンセル"
	variant="danger"
	on:confirm={handleRemoveGuestConfirm}
	on:cancel={handleRemoveGuestCancel}
/>

<!-- 一般検定員削除確認ダイアログ -->
<ConfirmDialog
	bind:isOpen={showRemoveParticipantDialog}
	title="検定員を削除"
	message={participantToRemove ? `検定員「${participantToRemove.name}」をセッションから削除しますか？\n\nこの操作は取り消せません。` : ''}
	confirmText="削除"
	cancelText="キャンセル"
	variant="danger"
	on:confirm={handleRemoveParticipantConfirm}
	on:cancel={handleRemoveParticipantCancel}
/>

<AlertDialog
	bind:isOpen={showAlert}
	title={alertTitle}
	message={alertMessage}
	confirmText="OK"
	on:confirm={() => {}}
/>

<Footer />

<style>
	.container {
		padding: 28px 20px;
		max-width: 500px;
		margin: 0 auto;
	}

	.settings-section {
		margin-bottom: 1.5rem;
	}
	.settings-title {
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 0.5rem;
		display: block;
		text-align: left;
	}
	.section-header-with-action {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.section-header-with-action .settings-title {
		margin-bottom: 0;
	}
	.refresh-btn-with-label {
		background: var(--bg-primary);
		border: 2px solid var(--border-light);
		border-radius: 8px;
		padding: 8px 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		cursor: pointer;
		transition: all 0.2s ease;
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 500;
	}
	.refresh-btn-with-label:hover {
		background: var(--bg-hover);
		border-color: var(--border-medium);
	}
	.refresh-btn-with-label:active {
		transform: scale(0.98);
		opacity: 0.7;
	}
	.refresh-btn-with-label.refreshing {
		pointer-events: none;
		opacity: 0.7;
	}
	.refresh-btn-with-label.refreshing svg {
		animation: spin 1s linear infinite;
	}
	.refresh-label {
		white-space: nowrap;
	}
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	input {
		width: 100%;
		padding: 12px;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		font-size: 16px;
	}
	.divider {
		border: none;
		border-top: 1px solid var(--separator-gray);
		margin: 24px 0;
	}
	.participants-container {
		background: white;
		border-radius: 12px;
		padding: 8px 16px;
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
	.participant-actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.chief-badge {
		font-size: 12px;
		font-weight: 600;
		color: #2d7a3e;
		margin-left: 8px;
	}
	.guest-badge {
		font-size: 12px;
		font-weight: 600;
		color: #666;
		margin-left: 8px;
	}
	.removed-badge {
		font-size: 12px;
		font-weight: 600;
		color: #999;
		background: #f0f0f0;
		padding: 2px 6px;
		border-radius: 4px;
		margin-left: 8px;
	}
	.participant-item.removed {
		opacity: 0.6;
	}
	.participant-item.removed .participant-name {
		color: #666;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
		max-width: 600px;
		margin-left: auto;
		margin-right: auto;
	}
	.appoint-btn {
		background-color: var(--keypad-bg);
		color: var(--primary-text);
		border: none;
		border-radius: 8px;
		padding: 10px 16px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
		min-height: 44px;
	}
	.appoint-btn:disabled {
		background-color: var(--ios-blue);
		color: white;
		cursor: default;
		opacity: 0.7;
	}
	.appoint-btn.danger {
		background-color: transparent;
		color: #dc3545;
		border: 1.5px solid #dc3545;
	}
	.appoint-btn.danger:hover {
		background-color: #ffe6e6;
	}
	.appoint-btn.danger:active {
		background-color: #ffcccc;
	}
	.settings-section {
		text-align: left;
	}
	.save-btn {
		width: 100%;
		background: var(--ios-blue);
		color: white;
		padding: 14px;
		border: none;
		border-radius: 8px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	.save-btn:active {
		opacity: 0.7;
	}
	.save-btn:disabled {
		background: #ccc;
		cursor: not-allowed;
		opacity: 0.6;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 900px;
		}
		.settings-title {
			font-size: 20px;
		}
		input {
			padding: 16px;
			font-size: 18px;
		}
		.participants-container {
			padding: 16px 24px;
		}
		.participant-item {
			padding: 16px 0;
		}
		.participant-name {
			font-size: 18px;
		}
		.appoint-btn {
			padding: 8px 16px;
			font-size: 16px;
		}
		.nav-buttons {
			gap: 16px;
		}
	}

	/* PC対応: デスクトップ */
	@media (min-width: 1024px) {
		.container {
			max-width: 1000px;
		}
	}

	/* 研修モード スコアボード */
	.scoreboard {
		background: white;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid var(--separator-gray);
	}

	.scoreboard-header,
	.scoreboard-row {
		display: grid;
		grid-template-columns: 2fr 2fr 2fr 1fr;
		gap: 8px;
		padding: 12px;
		font-size: 14px;
	}

	.scoreboard-header {
		background: #f5f5f5;
		font-weight: 600;
		border-bottom: 2px solid var(--separator-gray);
	}

	.scoreboard-row {
		border-bottom: 1px solid #f0f0f0;
	}

	.scoreboard-row:last-child {
		border-bottom: none;
	}

	.col-event,
	.col-athlete,
	.col-judge,
	.col-score {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.col-score {
		text-align: right;
		font-weight: 600;
		color: #ff9800;
	}

	.athlete-name {
		display: block;
		font-size: 12px;
		color: #666;
		margin-top: 2px;
	}

	/* セッション名ヘッダー */
	.session-header {
		margin-bottom: 32px;
	}

	.session-title {
		font-size: 32px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.name-display {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.edit-name-btn {
		background: transparent;
		border: none;
		color: var(--ios-blue);
		padding: 8px;
		border-radius: 6px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
		opacity: 0.7;
	}

	.edit-name-btn:hover {
		opacity: 1;
		background: rgba(0, 122, 255, 0.1);
	}

	.name-edit-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
		max-width: 500px;
	}

	.name-edit-form .name-input {
		width: 100%;
		padding: 12px 16px;
		border: 2px solid var(--separator-gray);
		border-radius: 10px;
		font-size: 24px;
		font-weight: 700;
		font-family: inherit;
		background: white;
		transition: all 0.2s;
	}

	.name-edit-form .name-input:focus {
		outline: none;
		border-color: var(--ios-blue);
	}

	.name-edit-form .name-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.name-edit-buttons {
		display: flex;
		gap: 8px;
	}

	.name-edit-buttons .save-btn {
		padding: 10px 20px;
		background: var(--ios-blue);
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		width: auto;
	}

	.name-edit-buttons .save-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.name-edit-buttons .save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.name-edit-buttons .cancel-btn {
		padding: 10px 20px;
		background: white;
		color: var(--secondary-text);
		border: 2px solid var(--separator-gray);
		border-radius: 8px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.name-edit-buttons .cancel-btn:hover:not(:disabled) {
		background: var(--bg-secondary);
	}

	.name-edit-buttons .cancel-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.success-notification {
		background: #e8f5e9;
		color: #2d7a3e;
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 16px;
		font-size: 14px;
		font-weight: 600;
	}

	.error-notification {
		background: #fee;
		color: #c33;
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 16px;
		font-size: 14px;
		font-weight: 600;
	}

	/* ゲスト招待セクション */
	.invite-container {
		background: white;
		border-radius: 12px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.invite-item {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.invite-label {
		font-size: 15px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.url-display,
	.code-display {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.url-input,
	.code-input {
		flex: 1;
		padding: 12px;
		border: 2px solid var(--border-medium);
		border-radius: 8px;
		font-size: 14px;
		color: var(--text-secondary);
		background: var(--bg-secondary);
		font-family: monospace;
	}

	.url-input:focus,
	.code-input:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	.code-input {
		font-weight: 700;
		letter-spacing: 2px;
		text-align: center;
		color: var(--text-primary);
	}

	.copy-btn {
		padding: 12px 16px;
		background: var(--accent-primary);
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.2s;
		font-family: inherit;
	}

	.copy-btn:hover {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.copy-btn:active {
		transform: translateY(0);
	}

	.qr-btn {
		width: 100%;
		padding: 14px;
		background: white;
		color: var(--text-primary);
		border: 2px solid var(--border-medium);
		border-radius: 8px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
	}

	.qr-btn:hover {
		background: var(--bg-secondary);
		border-color: var(--accent-primary);
	}

	.qr-btn:active {
		transform: scale(0.98);
	}

	.invite-note {
		font-size: 13px;
		color: var(--text-secondary);
		text-align: center;
		margin: 0;
		padding-top: 8px;
		border-top: 1px solid var(--border-light);
	}

	/* モバイル用改行 */
	.mobile-break {
		display: none;
	}

	@media (max-width: 480px) {
		.mobile-break {
			display: block;
		}
	}


	@media (max-width: 768px) {
		.scoreboard-header,
		.scoreboard-row {
			font-size: 12px;
			padding: 10px;
			gap: 6px;
		}

		.athlete-name {
			font-size: 11px;
		}
	}
</style>
