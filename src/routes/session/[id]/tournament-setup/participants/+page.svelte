<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { enhance } from '$app/forms';

	export let data: PageData;
	export let form: ActionData;

	$: sessionId = $page.params.id;

	let csvFile: File | null = null;
	let csvFileName = '';

	let bibNumber = '';
	let athleteName = '';
	let teamName = '';

	let editingParticipantId: number | null = null;
	let editBibNumber = '';
	let editAthleteName = '';
	let editTeamName = '';

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			csvFile = target.files[0];
			csvFileName = csvFile.name;
		}
	}

	function startEdit(participant: any) {
		editingParticipantId = participant.id;
		editBibNumber = participant.bib_number.toString();
		editAthleteName = participant.athlete_name;
		editTeamName = participant.team_name || '';
	}

	function cancelEdit() {
		editingParticipantId = null;
		editBibNumber = '';
		editAthleteName = '';
		editTeamName = '';
	}

	function clearForm() {
		bibNumber = '';
		athleteName = '';
		teamName = '';
	}

	function downloadTemplate() {
		const csvContent = 'ゼッケン番号,選手名,チーム名\n1,山田太郎,東京スキークラブ\n2,佐藤花子,北海道SC';
		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = 'participants_template.csv';
		link.click();
	}
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	isGuest={false}
	guestName={null}
/>

<div class="container">
	<div class="instruction">参加者登録</div>

	{#if form?.success}
		<div class="success-message">{form.message}</div>
	{/if}

	{#if form?.error}
		<div class="error-message">{form.error}</div>
	{/if}

	<!-- CSVインポート -->
	<div class="import-section">
		<h3>CSVファイルから一括登録</h3>
		<p class="import-info">
			CSVファイル形式: <code>ゼッケン番号,選手名,チーム名</code>
		</p>

		<button type="button" class="template-btn" on:click={downloadTemplate}>
			サンプルCSVをダウンロード
		</button>

		<form method="POST" action="?/importCSV" enctype="multipart/form-data" use:enhance>
			<div class="file-input-wrapper">
				<input
					type="file"
					id="csvFile"
					name="csvFile"
					accept=".csv"
					on:change={handleFileSelect}
					required
				/>
				<label for="csvFile" class="file-label">
					{csvFileName || 'CSVファイルを選択'}
				</label>
			</div>
			<button type="submit" class="import-btn" disabled={!csvFile}>CSVをインポート</button>
			<p class="import-warning">
				⚠️ インポートすると既存の参加者データは削除されます
			</p>
		</form>
	</div>

	<!-- 登録済み参加者一覧 -->
	{#if data.participants.length > 0}
		<div class="participants-section">
			<h3>登録済み参加者 ({data.participants.length}名)</h3>
			<div class="participants-list">
				{#each data.participants as participant}
					<div class="participant-item">
						{#if editingParticipantId === participant.id}
							<!-- 編集モード -->
							<form method="POST" action="?/updateParticipant" use:enhance class="edit-form">
								<input type="hidden" name="participantId" value={participant.id} />
								<div class="edit-inputs">
									<input
										type="number"
										name="bibNumber"
										placeholder="ゼッケン"
										bind:value={editBibNumber}
										min="1"
										required
									/>
									<input
										type="text"
										name="athleteName"
										placeholder="選手名"
										bind:value={editAthleteName}
										required
									/>
									<input
										type="text"
										name="teamName"
										placeholder="チーム名 (任意)"
										bind:value={editTeamName}
									/>
								</div>
								<div class="edit-actions">
									<button type="submit" class="save-btn">保存</button>
									<button type="button" class="cancel-btn" on:click={cancelEdit}>
										キャンセル
									</button>
								</div>
							</form>
						{:else}
							<!-- 表示モード -->
							<div class="participant-info">
								<span class="bib-number">No.{participant.bib_number}</span>
								<div class="participant-details">
									<span class="athlete-name">{participant.athlete_name}</span>
									{#if participant.team_name}
										<span class="team-name">{participant.team_name}</span>
									{/if}
								</div>
							</div>
							<div class="participant-actions">
								<button class="edit-btn" on:click={() => startEdit(participant)}>編集</button>
								<form method="POST" action="?/deleteParticipant" use:enhance style="display: inline;">
									<input type="hidden" name="participantId" value={participant.id} />
									<button
										type="submit"
										class="delete-btn"
										on:click={(e) => {
											if (!confirm('この参加者を削除しますか？')) {
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
		</div>
	{/if}

	<!-- 個別追加フォーム -->
	<div class="add-section">
		<h3>参加者を個別に追加</h3>
		<form method="POST" action="?/addParticipant" use:enhance on:submit={clearForm}>
			<div class="add-form">
				<div class="form-row">
					<input
						type="number"
						name="bibNumber"
						placeholder="ゼッケン番号"
						bind:value={bibNumber}
						min="1"
						required
					/>
				</div>
				<div class="form-row">
					<input
						type="text"
						name="athleteName"
						placeholder="選手名"
						bind:value={athleteName}
						required
					/>
				</div>
				<div class="form-row">
					<input
						type="text"
						name="teamName"
						placeholder="チーム名・所属 (任意)"
						bind:value={teamName}
					/>
				</div>
				<button type="submit" class="add-btn">追加</button>
			</div>
		</form>
	</div>

	<div class="nav-buttons">
		<NavButton on:click={() => goto(`/session/${sessionId}/tournament-setup`)}>
			設定画面に戻る
		</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		max-width: 700px;
		margin: 0 auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 28px;
		text-align: center;
		color: var(--primary-text);
	}
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

	/* CSVインポート */
	.import-section {
		background: #f0f8ff;
		border: 2px solid var(--ios-blue);
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 32px;
	}
	.import-section h3 {
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 12px;
		color: var(--primary-text);
	}
	.import-info {
		font-size: 14px;
		color: var(--secondary-text);
		margin-bottom: 12px;
	}
	.import-info code {
		background: white;
		padding: 2px 6px;
		border-radius: 4px;
		font-family: 'SF Mono', Monaco, monospace;
		font-size: 13px;
	}
	.template-btn {
		background: white;
		color: var(--ios-blue);
		border: 1px solid var(--ios-blue);
		padding: 8px 16px;
		border-radius: 8px;
		font-size: 14px;
		cursor: pointer;
		margin-bottom: 16px;
		transition: opacity 0.2s;
	}
	.template-btn:active {
		opacity: 0.7;
	}
	.file-input-wrapper {
		position: relative;
		margin-bottom: 12px;
	}
	.file-input-wrapper input[type='file'] {
		position: absolute;
		opacity: 0;
		width: 100%;
		height: 100%;
		cursor: pointer;
	}
	.file-label {
		display: block;
		background: white;
		border: 2px dashed var(--separator-gray);
		border-radius: 8px;
		padding: 20px;
		text-align: center;
		color: var(--secondary-text);
		cursor: pointer;
		transition: all 0.2s;
	}
	.file-input-wrapper:hover .file-label {
		border-color: var(--ios-blue);
		background: #f8f9fa;
	}
	.import-btn {
		width: 100%;
		background: var(--ios-blue);
		color: white;
		padding: 12px;
		border: none;
		border-radius: 8px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.2s;
		margin-bottom: 8px;
	}
	.import-btn:disabled {
		background: var(--separator-gray);
		cursor: not-allowed;
	}
	.import-btn:not(:disabled):active {
		opacity: 0.7;
	}
	.import-warning {
		font-size: 13px;
		color: #dc3545;
		text-align: center;
		margin: 0;
	}

	/* 登録済み参加者 */
	.participants-section {
		margin-bottom: 32px;
	}
	.participants-section h3 {
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 16px;
		color: var(--primary-text);
	}
	.participants-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.participant-item {
		background: white;
		border: 1px solid var(--separator-gray);
		border-radius: 12px;
		padding: 16px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.participant-info {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: 1;
	}
	.bib-number {
		font-weight: 600;
		color: white;
		background: var(--ios-blue);
		padding: 4px 12px;
		border-radius: 6px;
		font-size: 14px;
		min-width: 60px;
		text-align: center;
	}
	.participant-details {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.athlete-name {
		color: var(--primary-text);
		font-size: 16px;
		font-weight: 500;
	}
	.team-name {
		color: var(--secondary-text);
		font-size: 14px;
	}
	.participant-actions {
		display: flex;
		gap: 8px;
	}
	.edit-btn,
	.delete-btn {
		padding: 6px 12px;
		border-radius: 8px;
		border: none;
		font-size: 14px;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	.edit-btn {
		background: var(--ios-blue);
		color: white;
	}
	.edit-btn:active {
		opacity: 0.7;
	}
	.delete-btn {
		background: #dc3545;
		color: white;
	}
	.delete-btn:active {
		opacity: 0.7;
	}

	/* 編集フォーム */
	.edit-form {
		width: 100%;
	}
	.edit-inputs {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 12px;
	}
	.edit-inputs input {
		padding: 10px;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		font-size: 14px;
	}
	.edit-actions {
		display: flex;
		gap: 8px;
	}
	.save-btn,
	.cancel-btn {
		flex: 1;
		padding: 8px;
		border-radius: 8px;
		border: none;
		font-size: 14px;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	.save-btn {
		background: #2d7a3e;
		color: white;
	}
	.cancel-btn {
		background: var(--light-gray);
		color: var(--primary-text);
	}
	.save-btn:active,
	.cancel-btn:active {
		opacity: 0.7;
	}

	/* 個別追加フォーム */
	.add-section {
		background: #f8f9fa;
		border: 2px dashed var(--separator-gray);
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 28px;
	}
	.add-section h3 {
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 16px;
		color: var(--primary-text);
	}
	.add-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.form-row input {
		width: 100%;
		padding: 12px;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		font-size: 16px;
		background: white;
	}
	.add-btn {
		background: var(--ios-blue);
		color: white;
		padding: 12px;
		border: none;
		border-radius: 8px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	.add-btn:active {
		opacity: 0.7;
	}

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
</style>
