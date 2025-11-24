<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import { goto } from '$app/navigation';

	// This `form` variable will hold the data returned from the server action
	export let form: ActionData;
	export let data: PageData;

	let selectedMode: 'kentei' | 'tournament' | 'training' = 'kentei';
	let maxJudges = 100; // 研修モードのデフォルト最大検定員数
	let selectedOrganization = data.organizations[0]?.id || ''; // デフォルトで最初の組織を選択
	let isSubmitting = false;
</script>

<div class="container">
	<div class="instruction">新しいセッションを作成</div>

	<form
		method="POST"
		action="?/create"
		use:enhance={() => {
			isSubmitting = true;
			return async ({ update }) => {
				await update();
				isSubmitting = false;
			};
		}}
	>
		<div class="form-container">
			<input
				type="text"
				name="sessionName"
				id="session-name-input"
				placeholder="セッション名 (例: 2025冬期検定)"
				value={form?.sessionName ?? ''}
				disabled={isSubmitting}
			/>

			<!-- 組織選択（複数組織対応） -->
			{#if data.organizations.length > 1}
				<div class="organization-selection">
					<h3>組織選択</h3>
					<select
						name="organizationId"
						bind:value={selectedOrganization}
						class="org-select"
						disabled={isSubmitting}
					>
						{#each data.organizations as org}
							<option value={org.id}>{org.name}</option>
						{/each}
					</select>
					<p class="help-text">セッションを作成する組織を選択してください</p>
				</div>
			{:else}
				<!-- 組織が1つだけの場合は非表示のinputで送信 -->
				<input type="hidden" name="organizationId" value={selectedOrganization} />
			{/if}

			<div class="mode-selection">
				<h3>モード選択</h3>

				<label class="mode-option" class:selected={selectedMode === 'kentei'}>
					<input
						type="radio"
						name="mode"
						value="kentei"
						bind:group={selectedMode}
						disabled={isSubmitting}
					/>
					<div class="mode-content">
						<div class="mode-title">検定モード</div>
						<div class="mode-description">既定の種目で検定を実施</div>
					</div>
				</label>

				<label class="mode-option" class:selected={selectedMode === 'tournament'}>
					<input
						type="radio"
						name="mode"
						value="tournament"
						bind:group={selectedMode}
						disabled={isSubmitting}
					/>
					<div class="mode-content">
						<div class="mode-title">大会モード</div>
						<div class="mode-description">カスタム種目・採点方式・スコアボード</div>
					</div>
				</label>

				<label class="mode-option" class:selected={selectedMode === 'training'}>
					<input
						type="radio"
						name="mode"
						value="training"
						bind:group={selectedMode}
						disabled={isSubmitting}
					/>
					<div class="mode-content">
						<div class="mode-title">研修モード</div>
						<div class="mode-description">最大100名の検定員・個別採点表示</div>
					</div>
				</label>
			</div>

			<div class="help-link-section">
				<a href="/modes" class="help-link"> セッションモードについて → </a>
			</div>

			{#if selectedMode === 'training'}
				<div class="training-settings">
					<h4>研修モード設定</h4>
					<div class="setting-item">
						<label for="max-judges">最大検定員数（1〜100）</label>
						<input
							type="number"
							id="max-judges"
							name="maxJudges"
							min="1"
							max="100"
							bind:value={maxJudges}
							disabled={isSubmitting}
						/>
					</div>
					<p class="info-text">
						研修モードでは、検定員ごとの採点を個別に表示します。<br />
						3審3採・5審3採のような集計は行いません。
					</p>
				</div>
			{/if}

			{#if form?.error}
				<div class="error-container">
					<p class="error-message">{form.error}</p>
					{#if form?.upgradeUrl}
						<button type="button" class="upgrade-btn" on:click={() => goto(form.upgradeUrl)}>
							プランをアップグレード
						</button>
					{/if}
				</div>
			{/if}

			<div class="nav-buttons">
				<NavButton variant="primary" type="submit" disabled={isSubmitting}>
					{#if isSubmitting}
						<span style="display: inline-flex; align-items: center; gap: 8px;">
							作成中
							<LoadingSpinner size="small" inline={true} />
						</span>
					{:else}
						作成
					{/if}
				</NavButton>
			</div>
		</div>
	</form>

	<div class="nav-buttons">
		<NavButton on:click={() => goto('/dashboard')}>セッション選択画面に戻る</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 400px;
		margin: 0 auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 28px;
	}
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.form-container input {
		background: #fff;
		border: 1px solid var(--separator-gray);
		border-radius: 12px;
		padding: 15px;
		font-size: 16px;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.error-container {
		background: #fee;
		border: 2px solid #dc3545;
		border-radius: 12px;
		padding: 16px;
		text-align: center;
	}
	.error-message {
		color: #dc3545;
		font-size: 14px;
		margin-bottom: 12px;
	}
	.upgrade-btn {
		background: var(--ios-blue);
		color: white;
		padding: 12px 24px;
		border: none;
		border-radius: 8px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	.upgrade-btn:hover {
		opacity: 0.85;
	}
	.mode-selection {
		margin: 20px 0;
	}
	.mode-selection h3 {
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 12px;
		text-align: left;
		color: var(--primary-text);
	}
	.mode-option {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 16px;
		border: 2px solid var(--separator-gray);
		border-radius: 12px;
		margin-bottom: 12px;
		cursor: pointer;
		transition: all 0.2s;
		background: white;
	}
	.mode-option:hover {
		border-color: var(--ios-blue);
		background: #f8f9fa;
	}
	.mode-option.selected {
		border-color: var(--ios-blue);
		background: #e8f4ff;
	}
	.mode-option input[type='radio'] {
		margin-top: 2px;
		width: 20px;
		height: 20px;
		cursor: pointer;
	}
	.mode-content {
		flex: 1;
		text-align: left;
	}
	.mode-title {
		font-size: 17px;
		font-weight: 600;
		color: var(--primary-text);
		margin-bottom: 4px;
	}
	.mode-description {
		font-size: 14px;
		color: var(--secondary-text);
		line-height: 1.4;
	}
	.training-settings {
		background: #f8f9fa;
		border: 1px solid var(--separator-gray);
		border-radius: 12px;
		padding: 16px;
		text-align: left;
		margin-top: 12px;
	}
	.training-settings h4 {
		font-size: 16px;
		font-weight: 600;
		color: var(--primary-text);
		margin-bottom: 12px;
	}
	.setting-item {
		margin-bottom: 12px;
	}
	.setting-item label {
		display: block;
		font-size: 14px;
		font-weight: 500;
		color: var(--primary-text);
		margin-bottom: 6px;
	}
	.setting-item input[type='number'] {
		width: 100%;
		background: white;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		padding: 10px;
		font-size: 16px;
	}
	.info-text {
		font-size: 13px;
		color: var(--secondary-text);
		line-height: 1.5;
		margin: 0;
		padding-top: 8px;
		border-top: 1px solid var(--separator-gray);
	}
	.organization-selection {
		background: var(--bg-secondary);
		border-radius: 12px;
		padding: 16px;
		text-align: left;
	}
	.organization-selection h3 {
		font-size: 16px;
		font-weight: 600;
		color: var(--primary-text);
		margin: 0 0 12px 0;
	}
	.org-select {
		width: 100%;
		background: white;
		border: 2px solid var(--separator-gray);
		border-radius: 12px;
		padding: 12px;
		font-size: 16px;
		font-weight: 500;
		color: var(--primary-text);
		cursor: pointer;
		transition: all 0.2s;
	}
	.org-select:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.1);
	}
	.help-text {
		font-size: 13px;
		color: var(--secondary-text);
		margin: 8px 0 0 0;
		line-height: 1.5;
	}
	.help-link-section {
		text-align: center;
		margin-top: 0px;
	}
	.help-link {
		display: inline-flex;
		align-items: center;
		color: var(--accent-primary);
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
		transition: all 0.15s ease;
	}
	.help-link:hover {
		color: var(--accent-hover);
		text-decoration: underline;
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
		.form-container input {
			padding: 18px;
			font-size: 18px;
		}
		.mode-selection h3 {
			font-size: 20px;
			margin-bottom: 16px;
		}
		.mode-option {
			padding: 20px;
		}
		.mode-title {
			font-size: 20px;
		}
		.mode-description {
			font-size: 16px;
		}
		.nav-buttons {
			margin-top: 40px;
		}
	}
</style>
