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
	import QRCode from 'qrcode';
	import { onMount } from 'svelte';

	export let data: PageData;
	export let form: ActionData;

	$: sessionName = data.sessionDetails.name;
	$: participantCount = data.participants?.length || 0;

	let isMultiJudge = data.sessionDetails.is_multi_judge;
	let requiredJudges = data.sessionDetails.required_judges;

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

	// 大会モード用の採点方式
	let selectedMethod: '3judges' | '5judges' = data.sessionDetails.exclude_extremes
		? '5judges'
		: '3judges';

	// 点差コントロール用の変数
	let enableScoreDiffControl = data.sessionDetails.max_score_diff !== null;
	let maxScoreDiff = data.sessionDetails.max_score_diff || 2;

	// 検定員数に基づく採点方式の制限
	$: canUse3Judges = participantCount === 3;
	$: canUse5Judges = participantCount === 5;

	// 検定員数が条件に合わない場合、選択を自動調整
	$: if (!canUse5Judges && selectedMethod === '5judges') {
		// 5審3採が選択できない場合、3審3採に変更（3審3採が使える場合のみ）
		if (canUse3Judges) {
			selectedMethod = '3judges';
		}
	}
	$: if (!canUse3Judges && selectedMethod === '3judges') {
		// 3審3採が選択できない場合、5審3採に変更（5審3採が使える場合のみ）
		if (canUse5Judges) {
			selectedMethod = '5judges';
		}
	}

	let exportLoading = false;

	// 種目管理用の変数
	let eventName = '';
	let editingEventId: number | null = null;
	let editEventName = '';

	function startEditEvent(event: any) {
		editingEventId = event.id;
		editEventName = data.isTrainingMode ? event.name : event.event_name;
	}

	function cancelEditEvent() {
		editingEventId = null;
		editEventName = '';
	}

	function clearEventForm() {
		eventName = '';
	}

	// 研修モード設定
	let isMultiJudgeTraining = data.trainingSession?.is_multi_judge || false;

	// ゲストユーザー削除確認ダイアログ
	let showRemoveGuestDialog = false;
	let guestToRemove: { identifier: string; name: string } | null = null;
	let removeGuestForms: { [key: string]: HTMLFormElement } = {};

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

	// 参加者リスト更新
	let isRefreshing = false;
	function handleRefresh() {
		isRefreshing = true;
		window.location.reload();
	}

	// QRコード関連
	let showQRModal = false;
	let qrCodeDataUrl = '';
	let inviteUrl = '';
	let copiedInviteUrl = false;

	onMount(() => {
		// 招待URLを生成
		const baseUrl = window.location.origin;
		inviteUrl = `${baseUrl}/session/invite/${data.sessionDetails.invite_token}`;
	});

	async function generateQRCode() {
		try {
			qrCodeDataUrl = await QRCode.toDataURL(inviteUrl, {
				width: 300,
				margin: 2,
				color: {
					dark: '#171717',
					light: '#FFFFFF'
				}
			});
			showQRModal = true;
		} catch (err) {
			console.error('QRコード生成エラー:', err);
			alertMessage = 'QRコードの生成に失敗しました。';
			showAlert = true;
		}
	}

	function closeQRModal() {
		showQRModal = false;
	}

	async function downloadQR() {
		try {
			// 高解像度QRコードを生成
			const qrCodeDataUrlHD = await QRCode.toDataURL(inviteUrl, {
				width: 512,
				margin: 2
			});

			// ダウンロード
			const link = document.createElement('a');
			link.href = qrCodeDataUrlHD;
			link.download = `${data.sessionDetails.name}_招待QRコード.png`;
			link.click();
		} catch (err) {
			console.error('QRコードダウンロードエラー:', err);
			alertMessage = 'QRコードのダウンロードに失敗しました。';
			showAlert = true;
		}
	}

	function printQR() {
		window.print();
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

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} hasOrganization={data.organizations && data.organizations.length > 0} pageOrganizations={data.organizations || []} />

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
				<button class="qr-btn" on:click={generateQRCode}>
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

						{#if !p.is_guest && data.currentUserId === data.sessionDetails.created_by}
							<form method="POST" action="?/appointChief" use:enhance>
								<input type="hidden" name="userId" value={p.user_id} />
								<button
									type="submit"
									class="appoint-btn"
									class:danger={data.sessionDetails.chief_judge_id === p.user_id}
								>
									{#if data.sessionDetails.chief_judge_id === p.user_id}
										主任を解除
									{:else}
										主任に任命
									{/if}
								</button>
							</form>
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
				{/each}
			{:else}
				<p>参加者はいません。</p>
			{/if}
		</div>
	</div>

	<hr class="divider" />

	<!-- 種目管理セクション（大会・研修モードのみ） -->
	{#if data.isTournamentMode || data.isTrainingMode}
		<div class="settings-section">
			<h3 class="settings-title">種目管理</h3>

			{#if form?.eventSuccess}
				<div class="success-message">{form.eventSuccess}</div>
			{/if}

			{#if form?.eventError}
				<div class="error-message">{form.eventError}</div>
			{/if}

			{#if data.currentUserId === data.sessionDetails.chief_judge_id}
				<!-- 主任検定員のみ編集可能 -->
				<!-- 登録済み種目一覧 -->
				{#if data.events && data.events.length > 0}
					<div class="events-list">
						{#each data.events as event, index}
							<div class="event-item">
								{#if editingEventId === event.id}
									<!-- 編集モード -->
									<form method="POST" action="?/updateEvent" use:enhance class="edit-form">
										<input type="hidden" name="eventId" value={event.id} />
										<input type="hidden" name="isTraining" value={data.isTrainingMode} />
										<input
											type="text"
											name="eventName"
											bind:value={editEventName}
											placeholder="種目名"
											class="edit-input"
											required
										/>
										<div class="edit-actions">
											<button type="submit" class="save-btn-small">保存</button>
											<button type="button" class="cancel-btn-small" on:click={cancelEditEvent}>
												キャンセル
											</button>
										</div>
									</form>
								{:else}
									<!-- 表示モード -->
									<div class="event-info">
										<span class="event-number">{index + 1}.</span>
										<span class="event-text">
											{data.isTrainingMode ? event.name : event.event_name}
										</span>
									</div>
									<div class="event-actions">
										<button class="edit-btn-small" on:click={() => startEditEvent(event)}>
											編集
										</button>
										<form method="POST" action="?/deleteEvent" use:enhance style="display: inline;">
											<input type="hidden" name="eventId" value={event.id} />
											<input type="hidden" name="isTraining" value={data.isTrainingMode} />
											<button
												type="submit"
												class="delete-btn-small"
												on:click={(e) => {
													if (!confirm('この種目を削除しますか？')) {
														e.preventDefault();
													}
												}}
											>
												削除
											</button>
										</form>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="empty-message">種目が登録されていません</p>
				{/if}

				<!-- 新しい種目を追加 -->
				<form method="POST" action="?/addEvent" use:enhance on:submit={clearEventForm}>
					<div class="add-event-form">
						<input
							type="text"
							name="eventName"
							bind:value={eventName}
							placeholder="種目名 (例: 大回り)"
							required
						/>
						<button type="submit" class="add-event-btn">追加</button>
					</div>
				</form>
			{:else}
				<!-- 一般検定員: 表示のみ -->
				{#if data.events && data.events.length > 0}
					<div class="events-list readonly">
						{#each data.events as event, index}
							<div class="event-item readonly">
								<div class="event-info">
									<span class="event-number">{index + 1}.</span>
									<span class="event-text">
										{data.isTrainingMode ? event.name : event.event_name}
									</span>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="empty-message">種目が登録されていません</p>
				{/if}
				<p class="readonly-notice">※ 種目の追加・編集・削除は主任検定員のみ可能です</p>
			{/if}
		</div>

		<hr class="divider" />
	{/if}

	{#if data.sessionDetails.is_tournament_mode}
		<!-- 大会モード: 採点方法設定 -->
		<div class="settings-section">
			<h3 class="settings-title">採点方法設定</h3>

			{#if form?.tournamentSettingsSuccess}
				<div class="success-message">{form.tournamentSettingsSuccess}</div>
			{/if}

			{#if form?.tournamentSettingsError}
				<div class="error-message">{form.tournamentSettingsError}</div>
			{/if}

			{#if data.currentUserId === data.sessionDetails.chief_judge_id}
				<!-- 主任検定員のみ編集可能 -->
				<form
					method="POST"
					action="?/updateTournamentSettings"
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: false });
						};
					}}
				>
					{#if !canUse3Judges && !canUse5Judges}
						<div class="error-message">
							採点を開始するには、3人または5人の検定員が必要です。現在の検定員数: {participantCount}人
						</div>
					{/if}

					<div class="scoring-options">
						<!-- 3審3採 -->
						<label class="scoring-option" class:selected={selectedMethod === '3judges'} class:disabled={!canUse3Judges}>
							<input type="radio" name="scoringMethod" value="3judges" bind:group={selectedMethod} disabled={!canUse3Judges} />
							<div class="option-content">
								<div class="option-header">
									<span class="option-title">3審3採</span>
									{#if !canUse3Judges}
										<span class="required-badge">3人必要</span>
									{/if}
								</div>
								<div class="option-description">3人の検定員の点数の合計</div>
								<div class="option-example">例: 8.5 + 8.0 + 8.5 = 25.0点</div>
							</div>
						</label>

						<!-- 5審3採 -->
						<label class="scoring-option" class:selected={selectedMethod === '5judges'} class:disabled={!canUse5Judges}>
							<input type="radio" name="scoringMethod" value="5judges" bind:group={selectedMethod} disabled={!canUse5Judges} />
							<div class="option-content">
								<div class="option-header">
									<span class="option-title">5審3採</span>
									{#if !canUse5Judges}
										<span class="required-badge">5人必要</span>
									{/if}
								</div>
								<div class="option-description">
									5人の検定員で、最大点数と最小点数を除く、3人の検定員の合計点
								</div>
								<div class="option-example">
									例: 8.5 + 8.0 + <span class="excluded">9.0</span> + 8.5 +
									<span class="excluded">7.5</span> = 25.0点
								</div>
							</div>
						</label>
					</div>

					<!-- 点差コントロール設定 -->
					<div class="score-diff-section">
						<h4 class="subsection-title">点差コントロール</h4>

						<div class="score-diff-toggle">
							<input
								type="checkbox"
								id="enableScoreDiffControl"
								name="enableScoreDiffControl"
								bind:checked={enableScoreDiffControl}
							/>
							<label for="enableScoreDiffControl">点差制限を有効にする</label>
						</div>

						{#if enableScoreDiffControl}
							<div class="score-diff-input-group">
								<label for="maxScoreDiff" class="input-label">最大許容点差</label>
								<div class="input-with-unit">
									<input
										type="number"
										id="maxScoreDiff"
										name="maxScoreDiff"
										min="1"
										max="10"
										step="1"
										bind:value={maxScoreDiff}
										class="score-diff-input"
									/>
									<span class="unit">点</span>
								</div>
								<p class="help-text">
									最高点と最低点の差がこの値を超えた場合、得点を確定できません。
								</p>
							</div>
						{/if}
					</div>

					<div class="form-actions">
						<button type="submit" class="save-btn" disabled={!canUse3Judges && !canUse5Judges}>設定を保存</button>
					</div>
				</form>
			{:else}
				<!-- 一般検定員: 表示のみ -->
				<div class="readonly-scoring-method">
					<div class="method-display">
						<div class="method-title">
							{selectedMethod === '5judges' ? '5審3採' : '3審3採'}
						</div>
						<div class="method-description">
							{#if selectedMethod === '5judges'}
								5人の検定員で、最大点数と最小点数を除く、3人の検定員の合計点
							{:else}
								3人の検定員の点数の合計
							{/if}
						</div>
					</div>
				</div>
				<p class="readonly-notice">※ 採点方法の変更は主任検定員のみ可能です</p>
			{/if}
		</div>
		<hr class="divider" />
	{:else if data.isTrainingMode}
		<!-- 研修モード: 複数検定員モード設定 -->
		<div class="settings-section">
			<h3 class="settings-title">研修モード設定</h3>

			{#if form?.trainingSettingsSuccess}
				<div class="success-message">{form.trainingSettingsSuccess}</div>
			{/if}

			{#if form?.trainingSettingsError}
				<div class="error-message">{form.trainingSettingsError}</div>
			{/if}

			{#if data.currentUserId === data.sessionDetails.chief_judge_id}
				<!-- 主任検定員のみ編集可能 -->
				<form
					method="POST"
					action="?/updateTrainingSettings"
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: false });
						};
					}}
				>
					<div class="setting-item">
						<label for="multi-judge-toggle-training" class="form-label">複数検定員モード</label>
						<div class="toggle-switch">
							<input
								type="checkbox"
								id="multi-judge-toggle-training"
								name="isMultiJudge"
								bind:checked={isMultiJudgeTraining}
								value={isMultiJudgeTraining}
							/>
							<label for="multi-judge-toggle-training"></label>
						</div>
					</div>

					<div class="info-box">
						{#if isMultiJudgeTraining}
							<p><strong>ON:</strong> 主任検定員が採点指示を出し、全検定員が同じ選手・種目を採点します</p>
						{:else}
							<p><strong>OFF:</strong> 各検定員が自由に選手・種目を選んで採点できます</p>
						{/if}
					</div>

					<div class="form-actions">
						<button type="submit" class="save-btn">設定を保存</button>
					</div>
				</form>
			{:else}
				<!-- 一般検定員: 表示のみ -->
				<div class="setting-item">
					<span class="form-label">複数検定員モード</span>
					<div class="readonly-value">
						{isMultiJudgeTraining ? 'ON' : 'OFF'}
					</div>
				</div>

				<div class="info-box">
					{#if isMultiJudgeTraining}
						<p><strong>ON:</strong> 主任検定員が採点指示を出し、全検定員が同じ選手・種目を採点します</p>
					{:else}
						<p><strong>OFF:</strong> 各検定員が自由に選手・種目を選んで採点できます</p>
					{/if}
				</div>

				<p class="readonly-notice">※ 設定の変更は主任検定員のみ可能です</p>
			{/if}
		</div>
		<hr class="divider" />
	{:else}
		<!-- 検定モード: 従来の採点ルール設定 -->
		<div class="settings-section">
			<h3 class="settings-title">採点ルール設定</h3>

			{#if data.currentUserId === data.sessionDetails.chief_judge_id}
				<!-- 主任検定員のみ編集可能 -->
				<form
					method="POST"
					action="?/updateSettings"
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: false });
						};
					}}
				>
					<div class="setting-item">
						<label for="multi-judge-toggle" class="form-label">複数審判モード</label>
						<div class="toggle-switch">
							<input
								type="checkbox"
								id="multi-judge-toggle"
								name="isMultiJudge"
								bind:checked={isMultiJudge}
								value={isMultiJudge}
							/>
							<label for="multi-judge-toggle"></label>
						</div>
					</div>

					<div class="info-box">
						{#if isMultiJudge}
							<p><strong>ON:</strong> 主任検定員が採点指示を出し、全検定員が同じ選手・種目を採点します</p>
						{:else}
							<p><strong>OFF:</strong> 各検定員が自由に選手・種目を選んで採点できます</p>
						{/if}
					</div>

					{#if isMultiJudge}
					<div class="setting-item">
						<label for="required-judges-input" class="form-label">
							必須審判員数
							<span class="helper-text">(現在: {participantCount}人)</span>
						</label>
						<input
							type="number"
							id="required-judges-input"
							name="requiredJudges"
							bind:value={requiredJudges}
							min="1"
							max={participantCount}
							class="short-input"
						/>
					</div>
				{/if}

					{#if form?.settingsError}
						<p class="message">{form.settingsError}</p>
					{/if}
					{#if form?.settingsSuccess}
						<p class="message success">{form.settingsSuccess}</p>
					{/if}

					<div class="form-actions">
						<button type="submit" class="save-btn">設定を保存</button>
					</div>
				</form>
			{:else}
				<!-- 一般検定員: 表示のみ -->
				<div class="setting-item">
					<span class="form-label">複数審判モード</span>
					<div class="readonly-value">
						{isMultiJudge ? 'ON' : 'OFF'}
					</div>
				</div>

				<div class="info-box">
					{#if isMultiJudge}
						<p><strong>ON:</strong> 主任検定員が採点指示を出し、全検定員が同じ選手・種目を採点します</p>
					{:else}
						<p><strong>OFF:</strong> 各検定員が自由に選手・種目を選んで採点できます</p>
					{/if}
				</div>

				{#if isMultiJudge}
					<div class="setting-item">
						<span class="form-label">必須審判員数</span>
						<div class="readonly-value">{requiredJudges}人</div>
					</div>
				{/if}

				<p class="readonly-notice">※ 設定の変更は主任検定員のみ可能です</p>
			{/if}
		</div>
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
			<NavButton on:click={handleExport} disabled={exportLoading}>
				{exportLoading ? '準備中...' : '採点結果をエクスポート'}
			</NavButton>
		</div>
	</div>

	<hr class="divider" />

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
				この{data.sessionDetails.is_tournament_mode ? '大会' : '検定'}を削除
			</NavButton>
		</div>
	{/if}
</div>

<!-- QRコードモーダル -->
{#if showQRModal}
	<div class="modal-overlay" on:click={closeQRModal} role="button" tabindex="0" on:keydown={(e) => e.key === 'Escape' && closeQRModal()}>
		<div class="modal-content" on:click|stopPropagation role="button" tabindex="0" on:keydown={() => {}}>
			<div class="modal-header">
				<h2 class="modal-title">{data.sessionDetails.name}</h2>
				<button class="modal-close" on:click={closeQRModal} aria-label="閉じる">×</button>
			</div>

			<div class="modal-body">
				{#if qrCodeDataUrl}
					<img src={qrCodeDataUrl} alt="招待QRコード" class="qr-image" />
				{/if}
				<p class="qr-instruction">カメラで読み取ってください</p>
			</div>

			<div class="modal-actions">
				<button class="modal-btn secondary" on:click={downloadQR}>
					ダウンロード
				</button>
				<button class="modal-btn secondary" on:click={printQR}>
					印刷
				</button>
				<button class="modal-btn primary" on:click={closeQRModal}>
					閉じる
				</button>
			</div>
		</div>
	</div>
{/if}

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
	.form-label,
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
	.helper-text {
		font-size: 14px;
		font-weight: 400;
		color: var(--secondary-text);
		margin-left: 8px;
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
	.message {
		text-align: center;
		margin-top: 1rem;
		color: #dc3545;
	}
	.message.success {
		color: #2d7a3e;
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
	.settings-section {
		text-align: left;
	}
	.setting-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
		background: white;
		padding: 12px 16px;
		border-radius: 12px;
	}
	.short-input {
		width: 70px;
		padding: 10px !important;
		text-align: center;
	}
	.toggle-switch {
		position: relative;
		display: inline-block;
		width: 51px;
		height: 31px;
	}
	.toggle-switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}
	.toggle-switch label {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: var(--keypad-bg);
		transition: 0.4s;
		border-radius: 34px;
	}
	.toggle-switch label:before {
		position: absolute;
		content: '';
		height: 27px;
		width: 27px;
		left: 2px;
		bottom: 2px;
		background-color: white;
		transition: 0.4s;
		border-radius: 50%;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}
	.toggle-switch input:checked + label {
		background-color: #2d7a3e;
	}
	.toggle-switch input:checked + label:before {
		transform: translateX(20px);
	}

	/* 採点方式設定（大会モード） */
	.success-message {
		background: #e6f6e8;
		border: 1px solid #2d7a3e;
		color: #1e5c2e;
		padding: 12px;
		border-radius: 8px;
		margin-bottom: 20px;
		text-align: center;
	}
	.error-message {
		background: #ffe6e6;
		border: 1px solid #dc3545;
		color: #dc3545;
		padding: 12px;
		border-radius: 8px;
		margin-bottom: 20px;
		text-align: center;
	}

	.scoring-options {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-bottom: 24px;
	}
	.scoring-option {
		background: white;
		border: 2px solid var(--separator-gray);
		border-radius: 12px;
		padding: 20px;
		cursor: pointer;
		transition: all 0.2s;
		position: relative;
	}
	.scoring-option input[type='radio'] {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.scoring-option.selected {
		border-color: var(--ios-blue);
		background: #f0f8ff;
	}
	.scoring-option:hover {
		border-color: var(--ios-blue);
	}
	.scoring-option.disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background: #f5f5f5;
	}
	.scoring-option.disabled:hover {
		border-color: var(--separator-gray);
	}
	.option-content {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.option-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
		flex-wrap: wrap;
	}
	.option-title {
		font-size: 20px;
		font-weight: 600;
		color: var(--primary-text);
	}
	.required-badge {
		display: inline-block;
		background: #ff9800;
		color: white;
		padding: 4px 10px;
		border-radius: 12px;
		font-size: 12px;
		font-weight: 600;
	}
	.option-description {
		font-size: 15px;
		color: var(--secondary-text);
		line-height: 1.5;
	}
	.option-example {
		font-size: 14px;
		color: var(--secondary-text);
		font-family: 'SF Mono', Monaco, monospace;
		background: #f8f9fa;
		padding: 8px 12px;
		border-radius: 6px;
		margin-top: 4px;
	}
	.excluded {
		text-decoration: line-through;
		color: #dc3545;
	}

	.form-actions {
		margin-bottom: 12px;
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

	/* 種目管理のスタイル */
	.events-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 16px;
	}
	.events-list.readonly {
		gap: 8px;
	}
	.event-item {
		background: white;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		padding: 12px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.event-item.readonly {
		border: 2px solid var(--separator-gray);
		background: var(--bg-primary);
	}
	.event-info {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
	}
	.event-number {
		font-weight: 600;
		color: var(--secondary-text);
		min-width: 24px;
	}
	.event-text {
		color: var(--primary-text);
		font-size: 16px;
	}
	.event-actions {
		display: flex;
		gap: 8px;
	}
	.edit-btn-small,
	.delete-btn-small,
	.save-btn-small,
	.cancel-btn-small {
		padding: 10px 16px;
		border-radius: 6px;
		border: none;
		font-size: 14px;
		cursor: pointer;
		transition: opacity 0.2s;
		font-weight: 500;
		min-height: 44px;
	}
	.edit-btn-small {
		background: var(--ios-blue);
		color: white;
	}
	.delete-btn-small {
		background: #dc3545;
		color: white;
	}
	.save-btn-small {
		background: #2d7a3e;
		color: white;
	}
	.cancel-btn-small {
		background: var(--light-gray);
		color: var(--primary-text);
	}
	.edit-btn-small:active,
	.delete-btn-small:active,
	.save-btn-small:active,
	.cancel-btn-small:active {
		opacity: 0.7;
	}
	.edit-form {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.edit-input {
		padding: 8px !important;
		font-size: 14px !important;
		border-radius: 6px !important;
	}
	.edit-actions {
		display: flex;
		gap: 8px;
	}
	.add-event-form {
		display: flex;
		gap: 8px;
		margin-top: 16px;
	}
	.add-event-form input {
		flex: 1;
		padding: 10px;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		font-size: 14px;
	}
	.add-event-btn {
		background: var(--ios-blue);
		color: white;
		padding: 10px 20px;
		border: none;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.2s;
		white-space: nowrap;
	}
	.add-event-btn:active {
		opacity: 0.7;
	}
	.empty-message {
		text-align: center;
		color: var(--secondary-text);
		padding: 20px;
		font-size: 14px;
		background: #f8f9fa;
		border-radius: 8px;
		margin-bottom: 16px;
	}
	.info-box {
		background: #f0f8ff;
		border: 1px solid var(--ios-blue);
		border-radius: 8px;
		padding: 12px 16px;
		margin: 16px 0;
		text-align: left;
	}
	.info-box p {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
		color: var(--primary-text);
	}
	.info-box strong {
		color: var(--ios-blue);
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 900px;
		}
		.form-label,
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
		.scoring-option {
			padding: 24px;
		}
		.option-title {
			font-size: 22px;
		}
		.option-description {
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

	/* 一般検定員向けの表示のみスタイル */
	.readonly-value {
		font-size: 16px;
		font-weight: 600;
		color: var(--primary-text);
		padding: 8px 0;
	}

	.readonly-notice {
		font-size: 14px;
		color: #666;
		font-style: italic;
		margin-top: 12px;
		text-align: center;
	}

	/* 採点方法の読み取り専用表示 */
	.readonly-scoring-method {
		background: var(--bg-primary);
		border: 2px solid var(--separator-gray);
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 12px;
	}

	.method-display {
		text-align: center;
	}

	.method-title {
		font-size: 24px;
		font-weight: 600;
		color: var(--primary-text);
		margin-bottom: 12px;
	}

	.method-description {
		font-size: 15px;
		color: var(--secondary-text);
		line-height: 1.5;
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

	/* QRコードモーダル */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 1000;
		padding: 20px;
	}

	.modal-content {
		background: white;
		border-radius: 16px;
		max-width: 400px;
		width: 100%;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
		animation: modalFadeIn 0.2s ease-out;
	}

	@keyframes modalFadeIn {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 20px 24px;
		border-bottom: 2px solid var(--border-light);
	}

	.modal-title {
		font-size: 18px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.modal-close {
		width: 32px;
		height: 32px;
		border: none;
		background: var(--bg-secondary);
		border-radius: 50%;
		font-size: 24px;
		line-height: 1;
		cursor: pointer;
		color: var(--text-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.modal-close:hover {
		background: var(--border-medium);
		color: var(--text-primary);
	}

	.modal-body {
		padding: 32px 24px;
		text-align: center;
	}

	.qr-image {
		width: 300px;
		height: 300px;
		border: 2px solid var(--border-medium);
		border-radius: 12px;
		padding: 16px;
		background: white;
		margin: 0 auto 20px;
	}

	.qr-instruction {
		font-size: 15px;
		color: var(--text-secondary);
		margin: 0;
	}

	.modal-actions {
		padding: 16px 24px 24px;
		display: flex;
		gap: 12px;
		justify-content: center;
	}

	.modal-btn {
		padding: 14px 24px;
		border: none;
		border-radius: 10px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
	}

	.modal-btn.primary {
		background: var(--accent-primary);
		color: white;
		flex: 1;
	}

	.modal-btn.primary:hover {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.modal-btn.secondary {
		background: var(--bg-secondary);
		color: var(--text-primary);
		border: 2px solid var(--border-medium);
	}

	.modal-btn.secondary:hover {
		background: var(--border-light);
	}

	.modal-btn:active {
		transform: translateY(0);
	}

	/* 点差コントロール */
	.score-diff-section {
		margin-top: 32px;
		margin-bottom: 24px;
		padding: 24px;
		background: var(--bg-secondary);
		border-radius: 12px;
		border: 1px solid var(--border-medium);
	}

	.subsection-title {
		font-size: 18px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 16px;
	}

	.score-diff-toggle {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 20px;
	}

	.score-diff-toggle input[type="checkbox"] {
		width: 20px;
		height: 20px;
		cursor: pointer;
	}

	.score-diff-toggle label {
		font-size: 15px;
		font-weight: 600;
		color: var(--text-primary);
		cursor: pointer;
	}

	.score-diff-input-group {
		padding-left: 32px;
		margin-top: 16px;
	}

	.input-label {
		display: block;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 8px;
	}

	.input-with-unit {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}

	.score-diff-input {
		width: 100px;
		padding: 10px 12px;
		font-size: 16px;
		border: 2px solid var(--border-medium);
		border-radius: 8px;
		font-family: inherit;
		transition: all 0.2s;
	}

	.score-diff-input:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px rgba(23, 23, 23, 0.1);
	}

	.unit {
		font-size: 15px;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.help-text {
		font-size: 13px;
		color: var(--text-secondary);
		line-height: 1.5;
		margin: 0;
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

		.score-diff-section {
			padding: 16px;
		}

		.subsection-title {
			font-size: 16px;
		}
	}
</style>
