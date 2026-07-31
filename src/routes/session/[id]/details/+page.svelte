<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import QRInviteModal from '$lib/components/QRInviteModal.svelte';
	import EventManagement from '$lib/components/EventManagement.svelte';
	import TournamentSettings from '$lib/components/TournamentSettings.svelte';
	import MultiJudgeSettings from '$lib/components/MultiJudgeSettings.svelte';
	import SessionParticipants from '$lib/components/SessionParticipants.svelte';
	import TrainingScoreboard from '$lib/components/TrainingScoreboard.svelte';
	import { exportSessionResults } from '$lib/exportSessionResults';
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';

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
	let alertTitle = m.common_error();

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
	let deleteTournamentDataForm: HTMLFormElement;
	let deleteSessionForm: HTMLFormElement;

	// 採点データ削除確認ダイアログ
	let showDeleteDataDialog = false;
	let deleteDataTarget: 'training' | 'certification' | 'tournament' | null = null;

	function openDeleteDataDialog(target: 'training' | 'certification' | 'tournament') {
		deleteDataTarget = target;
		showDeleteDataDialog = true;
	}

	function handleDeleteDataConfirm() {
		if (deleteDataTarget === 'training' && deleteDataForm) {
			deleteDataForm.requestSubmit();
		} else if (deleteDataTarget === 'certification' && deleteCertificationDataForm) {
			deleteCertificationDataForm.requestSubmit();
		} else if (deleteDataTarget === 'tournament' && deleteTournamentDataForm) {
			deleteTournamentDataForm.requestSubmit();
		}
		showDeleteDataDialog = false;
		deleteDataTarget = null;
	}

	function handleDeleteDataCancel() {
		showDeleteDataDialog = false;
		deleteDataTarget = null;
	}

	// セッション削除確認ダイアログ
	let showDeleteSessionDialog = false;

	function handleDeleteSessionConfirm() {
		if (deleteSessionForm) {
			deleteSessionForm.requestSubmit();
		}
		showDeleteSessionDialog = false;
	}

	function handleDeleteSessionCancel() {
		showDeleteSessionDialog = false;
	}

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
				console.error('Copy failed:', err);
				alert(m.details_copyFailed());
			}
		);
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
				console.error('Copy failed:', err);
				alertMessage = m.details_urlCopyFailed();
				showAlert = true;
			}
		);
	}

	async function handleExport() {
		exportLoading = true;
		try {
			const result = await exportSessionResults(data.sessionDetails.id, data.sessionDetails.name);

			if (!result.ok) {
				alertMessage =
					result.reason === 'no-data' ? m.details_noExportData() : m.details_exportError();
				showAlert = true;
			}
		} finally {
			exportLoading = false;
		}
	}
</script>

<Header
	showAppName={true}
	pageUser={data.user}
	pageProfile={data.profile}
	hasOrganization={data.hasOrganization}
/>

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
					placeholder={m.details_enterSessionName()}
					required
					maxlength="200"
					disabled={isSubmittingName}
				/>
				<div class="name-edit-buttons">
					<button type="submit" class="save-btn" disabled={isSubmittingName}>
						{isSubmittingName ? m.settings_saving() : m.common_save()}
					</button>
					<button
						type="button"
						class="cancel-btn"
						on:click={cancelEditingName}
						disabled={isSubmittingName}
					>
						{m.common_cancel()}
					</button>
				</div>
			</form>
		{:else}
			<!-- 表示モード -->
			<div class="name-display">
				<h1 class="session-title">{data.sessionDetails.name}</h1>
				{#if isCreator}
					<button
						class="edit-name-btn"
						on:click={startEditingName}
						title={m.details_editSessionName()}
					>
						<Icon name="edit" size={16} />
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<!-- ユーザーを招待セクション -->
	<div class="settings-section">
		<h3 class="settings-title"><Icon name="invite" size={20} />{m.details_inviteUsers()}</h3>
		<div class="invite-container">
			<div class="invite-item">
				<span class="invite-label">{m.details_joinCode()}</span>
				<div class="code-display">
					<input type="text" value={data.sessionDetails.join_code} readonly class="code-input" />
					<button class="copy-btn" on:click={copyJoinCode}>
						{copiedCode ? m.details_copied() : m.details_copy()}
					</button>
				</div>
			</div>
			<p class="invite-note">{m.details_inviteNote()}</p>
		</div>
	</div>

	<!-- ゲスト招待セクション -->
	<div class="settings-section">
		<h3 class="settings-title"><Icon name="invite" size={20} />{m.details_inviteGuests()}</h3>
		<div class="invite-container">
			<div class="invite-item">
				<span class="invite-label">{m.details_inviteUrl()}</span>
				<div class="url-display">
					<input type="text" value={inviteUrl} readonly class="url-input" />
					<button class="copy-btn" on:click={copyInviteUrl}>
						{copiedInviteUrl ? m.details_copied() : m.details_copy()}
					</button>
				</div>
			</div>

			<div class="invite-item">
				<span class="invite-label">{m.details_qrCode()}</span>
				<button class="qr-btn" on:click={openQRModal}>
					<Icon name="scan" size={18} />
					{m.details_showQR()}
				</button>
			</div>

			<p class="invite-note">{m.details_guestInviteNote()}</p>
		</div>
	</div>

	<hr class="divider" />

	<div class="settings-section">
		<SessionParticipants
			participants={data.participants}
			currentUserId={data.currentUserId}
			createdBy={data.sessionDetails.created_by}
			chiefJudgeId={data.sessionDetails.chief_judge_id}
		/>
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
			<h3 class="settings-title">{m.details_scoringResults()}</h3>
			<TrainingScoreboard scores={data.trainingScores} />
		</div>
		<hr class="divider" />
	{/if}

	{#if data.sessionDetails.is_tournament_mode || data.currentUserId === data.sessionDetails.created_by}
		<div class="settings-section">
			<h3 class="settings-title">{m.details_dataManagement()}</h3>
			<div class="nav-buttons">
				{#if data.sessionDetails.is_tournament_mode}
					<NavButton
						variant="primary"
						on:click={() => goto(`/session/${data.sessionDetails.id}/scoreboard`)}
					>
						<Icon name="scoreboard" size={18} />
						{m.details_showScoreboard()}
					</NavButton>
				{/if}
				{#if data.currentUserId === data.sessionDetails.created_by}
					<NavButton on:click={handleExport} disabled={exportLoading}>
						<Icon name="export" size={18} />
						{exportLoading ? m.details_preparing() : m.details_exportResults()}
					</NavButton>
					{#if data.isTrainingMode}
						<NavButton variant="danger" on:click={() => openDeleteDataDialog('training')}>
							<Icon name="trash" size={18} />
							{m.details_deleteScoreData()}
						</NavButton>
					{:else if data.sessionDetails.is_tournament_mode}
						<NavButton variant="danger" on:click={() => openDeleteDataDialog('tournament')}>
							<Icon name="trash" size={18} />
							{m.details_deleteScoreData()}
						</NavButton>
					{:else}
						<NavButton variant="danger" on:click={() => openDeleteDataDialog('certification')}>
							<Icon name="trash" size={18} />
							{m.details_deleteScoreData()}
						</NavButton>
					{/if}
				{/if}
			</div>
		</div>

		<hr class="divider" />
	{/if}

	<div class="nav-buttons">
		<NavButton on:click={() => goto('/dashboard')}>
			{m.session_backToSelection()}
		</NavButton>
	</div>

	{#if data.currentUserId === data.sessionDetails.created_by}
		<div class="nav-buttons">
			<NavButton
				variant="danger"
				on:click={() => {
					showDeleteSessionDialog = true;
				}}
			>
				<Icon name="trash" size={18} />
				{m.details_deleteSession({
					mode: data.isTrainingMode
						? m.mode_training()
						: data.sessionDetails.is_tournament_mode
							? m.mode_tournament()
							: m.mode_certification()
				})}
			</NavButton>
		</div>
	{/if}
</div>

<!-- QRコードモーダル -->
<QRInviteModal
	{inviteUrl}
	sessionName={data.sessionDetails.name}
	show={showQRModal}
	on:close={closeQRModal}
/>

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
					alert(`${m.common_error()}: ${result.data.error}`);
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
					alert(`${m.common_error()}: ${result.data.error}`);
				}
			} else {
				await update();
			}
		};
	}}
	style="display: none;"
></form>

<!-- 非表示フォーム: 大会モード採点データ削除 -->
<form
	bind:this={deleteTournamentDataForm}
	method="POST"
	action="?/deleteTournamentData"
	use:enhance={() => {
		return async ({ result, update }) => {
			if (result.type === 'success') {
				await update();
				window.location.reload();
			} else if (result.type === 'failure') {
				await update();
				if (result.data?.error) {
					alert(`${m.common_error()}: ${result.data.error}`);
				}
			} else {
				await update();
			}
		};
	}}
	style="display: none;"
></form>

<!-- 採点データ削除確認ダイアログ -->
<ConfirmDialog
	bind:isOpen={showDeleteDataDialog}
	title={m.details_deleteScoreDataTitle()}
	message={deleteDataTarget === 'training'
		? m.details_deleteScoreDataMessage({ mode: m.mode_training() })
		: deleteDataTarget === 'tournament'
			? m.details_deleteScoreDataMessage({ mode: m.mode_tournament() })
			: m.details_deleteScoreDataMessage({ mode: m.mode_certification() })}
	confirmText={m.details_deleteConfirm()}
	cancelText={m.common_cancel()}
	variant="danger"
	on:confirm={handleDeleteDataConfirm}
	on:cancel={handleDeleteDataCancel}
/>

<!-- セッション削除確認ダイアログ -->
<ConfirmDialog
	bind:isOpen={showDeleteSessionDialog}
	title={m.details_deleteSession({
		mode: data.isTrainingMode
			? m.mode_training()
			: data.sessionDetails.is_tournament_mode
				? m.mode_tournament()
				: m.mode_certification()
	})}
	message={m.details_deleteSessionMessage({ name: data.sessionDetails.name })}
	confirmText={m.details_deleteConfirm()}
	cancelText={m.common_cancel()}
	variant="danger"
	on:confirm={handleDeleteSessionConfirm}
	on:cancel={handleDeleteSessionCancel}
/>

<!-- 非表示フォーム: セッション削除 -->
<form
	bind:this={deleteSessionForm}
	method="POST"
	action="?/deleteSession"
	use:enhance={() => {
		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				await update();
			} else if (result.type === 'failure') {
				await update();
				if (result.data?.error) {
					alertTitle = m.common_error();
					alertMessage = result.data.error;
					showAlert = true;
				}
			} else {
				await update();
			}
		};
	}}
	style="display: none;"
></form>

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
		display: inline-flex;
		align-items: center;
		gap: 8px;
		text-align: left;
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
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
		max-width: 600px;
		margin-left: auto;
		margin-right: auto;
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
		background: var(--color-success-tint);
		color: var(--color-success);
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 16px;
		font-size: 14px;
		font-weight: 600;
	}

	.error-notification {
		background: var(--color-error-tint);
		color: var(--color-error);
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
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
</style>
