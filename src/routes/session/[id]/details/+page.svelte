<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import * as XLSX from 'xlsx';

	export let data: PageData;
	export let form: ActionData;

	$: sessionName = data.sessionDetails.name;
	$: participantCount = data.participants?.length || 0;

	let isMultiJudge = data.sessionDetails.is_multi_judge;
	let requiredJudges = data.sessionDetails.required_judges;

	// 大会モード用の採点方式
	let selectedMethod: '3judges' | '5judges' = data.sessionDetails.exclude_extremes
		? '5judges'
		: '3judges';

	let exportLoading = false;

	async function handleExport() {
		exportLoading = true;
		try {
			// 1. Fetch data from our new server endpoint
			const response = await fetch(`/api/export/${data.sessionDetails.id}`);
			const jsonData = await response.json();

			if (!response.ok || !jsonData.results || jsonData.results.length === 0) {
				alert('エクスポートするデータがありません。');
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

			// 4. Trigger the download
			const fileName = `${data.sessionDetails.name}_採点結果.xlsx`;
			XLSX.writeFile(workbook, fileName);
		} catch (err) {
			console.error('Export failed:', err);
			alert('エクスポート処理中にエラーが発生しました。');
		} finally {
			exportLoading = false;
		}
	}
</script>

<div class="container">
	<div class="instruction">{data.sessionDetails.name} の詳細</div>

	<form
		method="POST"
		action="?/updateName"
		use:enhance={() => {
			return async ({ update }) => {
				await update({ reset: false });
			};
		}}
	>
		<div class="form-container">
			<label for="session-name" class="form-label">検定名</label>
			<input type="text" id="session-name" name="sessionName" bind:value={sessionName} />

			<div class="nav-buttons">
				<NavButton variant="primary" type="submit">名前を更新</NavButton>
			</div>

			{#if form?.message}
				<p class="message" class:success={form?.success}>{form.message}</p>
			{/if}
		</div>
	</form>
	<hr class="divider" />

	<div class="settings-section">
		<h3 class="settings-title">参加中の検定員</h3>
		<div class="participants-container">
			{#if data.participants && data.participants.length > 0}
				{#each data.participants as p}
					<div class="participant-item">
						<span class="participant-name">
							{p.profiles?.full_name || 'プロフィール未設定'}
							{#if data.sessionDetails.chief_judge_id === p.user_id}
								<span class="chief-badge">(主任)</span>
							{/if}
						</span>

						{#if data.currentUserId === data.sessionDetails.created_by}
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
					</div>
				{/each}
			{:else}
				<p>参加者はいません。</p>
			{/if}
		</div>
	</div>

	<hr class="divider" />

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

			<form
				method="POST"
				action="?/updateTournamentSettings"
				use:enhance={() => {
					return async ({ update }) => {
						await update({ reset: false });
					};
				}}
			>
				<div class="scoring-options">
					<!-- 3審3採 -->
					<label class="scoring-option" class:selected={selectedMethod === '3judges'}>
						<input type="radio" name="scoringMethod" value="3judges" bind:group={selectedMethod} />
						<div class="option-content">
							<div class="option-header">
								<span class="option-title">3審3採</span>
							</div>
							<div class="option-description">3人の検定員の点数の合計</div>
							<div class="option-example">例: 8.5 + 8.0 + 8.5 = 25.0点</div>
						</div>
					</label>

					<!-- 5審3採 -->
					<label class="scoring-option" class:selected={selectedMethod === '5judges'}>
						<input type="radio" name="scoringMethod" value="5judges" bind:group={selectedMethod} />
						<div class="option-content">
							<div class="option-header">
								<span class="option-title">5審3採</span>
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

				<div class="form-actions">
					<button type="submit" class="save-btn">採点方法を保存</button>
				</div>
			</form>
		</div>
		<hr class="divider" />
	{:else}
		<!-- 検定モード: 従来の採点ルール設定 -->
		<form
			method="POST"
			action="?/updateSettings"
			use:enhance={() => {
				return async ({ update }) => {
					await update({ reset: false });
				};
			}}
		>
			<div class="settings-section">
				<h3 class="settings-title">採点ルール設定</h3>
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

				<div class="nav-buttons">
					<NavButton variant="primary" type="submit">ルールを保存</NavButton>
				</div>
			</div>
		</form>
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
			{data.sessionDetails.is_tournament_mode ? '大会選択に戻る' : '検定選択に戻る'}
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

<style>
	.container {
		padding: 28px 20px;
		max-width: 500px;
		margin: 0 auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 28px;
		text-align: center;
	}
	.form-container,
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
		color: var(--ios-green);
		margin-left: 8px;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.message {
		text-align: center;
		margin-top: 1rem;
		color: var(--ios-red);
	}
	.message.success {
		color: var(--ios-green);
	}
	.appoint-btn {
		background-color: var(--keypad-bg);
		color: var(--primary-text);
		border: none;
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
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
		background-color: var(--ios-green);
	}
	.toggle-switch input:checked + label:before {
		transform: translateX(20px);
	}

	/* 採点方式設定（大会モード） */
	.success-message {
		background: #e6f6e8;
		border: 1px solid var(--ios-green);
		color: #1e5c2e;
		padding: 12px;
		border-radius: 8px;
		margin-bottom: 20px;
		text-align: center;
	}
	.error-message {
		background: #ffe6e6;
		border: 1px solid var(--ios-red);
		color: var(--ios-red);
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
	}
	.option-title {
		font-size: 20px;
		font-weight: 600;
		color: var(--primary-text);
	}
	.option-badge {
		font-size: 12px;
		font-weight: 500;
		color: white;
		background: var(--ios-blue);
		padding: 2px 8px;
		border-radius: 4px;
	}
	.option-badge.advanced {
		background: var(--ios-green);
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
		color: var(--ios-red);
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

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 900px;
		}
		.instruction {
			font-size: 36px;
			margin-bottom: 40px;
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
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			gap: 16px;
		}
	}

	/* PC対応: デスクトップ */
	@media (min-width: 1024px) {
		.container {
			max-width: 1000px;
		}
	}
</style>
