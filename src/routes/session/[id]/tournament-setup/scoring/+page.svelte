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
	$: judgeCount = data.judgeCount;

	// 現在の採点方式を取得
	let selectedMethod: '3judges' | '5judges' = data.sessionDetails.exclude_extremes
		? '5judges'
		: '3judges';

	// ローディング状態
	let isSaving = false;

	// 検定員数に基づいて選択可能かどうかを判定（厳密に一致する必要がある）
	$: canSelect3Judges = judgeCount === 3;
	$: canSelect5Judges = judgeCount === 5;

	// 検定員数が変わったときに、現在の選択が無効な場合は自動調整
	$: {
		if (selectedMethod === '3judges' && !canSelect3Judges) {
			// 3審3採が選択されているが無効な場合
			if (canSelect5Judges) {
				selectedMethod = '5judges';
			}
		} else if (selectedMethod === '5judges' && !canSelect5Judges) {
			// 5審3採が選択されているが無効な場合
			if (canSelect3Judges) {
				selectedMethod = '3judges';
			}
		}
	}
</script>

<Header
	pageUser={data.user}
	pageProfile={data.profile}
	isGuest={false}
	guestName={null}
/>

<div class="container">
	<div class="instruction">採点方式設定</div>

	<div class="judge-count-info">
		<p>現在の検定員数: <strong>{judgeCount}人</strong></p>
	</div>

	{#if form?.success}
		<div class="success-message">{form.message}</div>
	{/if}

	{#if form?.error}
		<div class="error-message">{form.error}</div>
	{/if}

	<form
		method="POST"
		action="?/updateScoringMethod"
		use:enhance={() => {
			isSaving = true;
			return async ({ update }) => {
				await update();
				isSaving = false;
			};
		}}
	>
		<div class="scoring-options">
			<!-- 3審3採 -->
			<label class="scoring-option" class:selected={selectedMethod === '3judges'} class:disabled={!canSelect3Judges}>
				<input type="radio" name="scoringMethod" value="3judges" bind:group={selectedMethod} disabled={!canSelect3Judges} />
				<div class="option-content">
					<div class="option-header">
						<span class="option-title">3審3採</span>
						<span class="option-badge">標準</span>
					</div>
					<div class="option-description">3人の検定員の点数の合計</div>
					<div class="option-example">例: 8.5 + 8.0 + 8.5 = 25.0点</div>
					{#if !canSelect3Judges}
						<div class="requirement-warning">検定員数がちょうど3人の時のみ選択できます（現在: {judgeCount}人）</div>
					{/if}
				</div>
			</label>

			<!-- 5審3採 -->
			<label class="scoring-option" class:selected={selectedMethod === '5judges'} class:disabled={!canSelect5Judges}>
				<input type="radio" name="scoringMethod" value="5judges" bind:group={selectedMethod} disabled={!canSelect5Judges} />
				<div class="option-content">
					<div class="option-header">
						<span class="option-title">5審3採</span>
						<span class="option-badge advanced">上級</span>
					</div>
					<div class="option-description">
						5人の検定員で、最大点数と最小点数を除く、3人の検定員の合計点
					</div>
					<div class="option-example">
						例: 8.5 + 8.0 + <span class="excluded">9.0</span> + 8.5 +
						<span class="excluded">7.5</span> = 25.0点
					</div>
					{#if !canSelect5Judges}
						<div class="requirement-warning">検定員数がちょうど5人の時のみ選択できます（現在: {judgeCount}人）</div>
					{/if}
				</div>
			</label>
		</div>

		<div class="form-actions">
			<button type="submit" class="save-btn" disabled={isSaving}>
				{#if isSaving}
					<span class="loading-spinner"></span>
					保存中...
				{:else}
					設定を保存
				{/if}
			</button>
		</div>
	</form>

	<div class="nav-buttons">
		<NavButton on:click={() => goto(`/session/${sessionId}/tournament-setup`)}>
			設定画面に戻る
		</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		max-width: 600px;
		margin: 0 auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 20px;
		text-align: center;
		color: var(--primary-text);
	}
	.judge-count-info {
		background: #f8f9fa;
		border-radius: 8px;
		padding: 12px 16px;
		margin-bottom: 24px;
		text-align: center;
	}
	.judge-count-info p {
		margin: 0;
		font-size: 15px;
		color: var(--secondary-text);
	}
	.judge-count-info strong {
		color: var(--primary-text);
		font-size: 18px;
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
	.scoring-option:hover:not(.disabled) {
		border-color: var(--ios-blue);
	}
	.scoring-option.disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background: #f8f9fa;
		pointer-events: none;
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
		background: #2d7a3e;
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
	.requirement-warning {
		font-size: 14px;
		color: #dc3545;
		background: #ffe6e6;
		padding: 8px 12px;
		border-radius: 6px;
		margin-top: 8px;
		font-weight: 500;
	}

	.form-actions {
		margin-bottom: 28px;
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

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	/* ローディングスピナー */
	.loading-spinner {
		display: inline-block;
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spinner-rotate 0.6s linear infinite;
		margin-right: 8px;
		vertical-align: middle;
	}

	@keyframes spinner-rotate {
		to {
			transform: rotate(360deg);
		}
	}

	.save-btn:disabled .loading-spinner {
		border-color: rgba(0, 0, 0, 0.2);
		border-top-color: rgba(0, 0, 0, 0.5);
	}
</style>
