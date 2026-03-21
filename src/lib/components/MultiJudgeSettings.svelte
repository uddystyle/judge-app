<script lang="ts">
	import { enhance } from '$app/forms';

	export let isChief: boolean;
	export let mode: 'training' | 'certification';
	export let isMultiJudge: boolean;
	export let requiredJudges: number | null = null;
	export let participantCount: number = 0;
	export let settingsSuccess: string | undefined = undefined;
	export let settingsError: string | undefined = undefined;

	let localIsMultiJudge = isMultiJudge;
	let localRequiredJudges = requiredJudges;
	let isSaving = false;

	$: title = mode === 'training' ? '研修モード設定' : '採点ルール設定';
	$: action = mode === 'training' ? '?/updateTrainingSettings' : '?/updateSettings';
	$: toggleId = mode === 'training' ? 'multi-judge-toggle-training' : 'multi-judge-toggle';
	$: toggleLabel = mode === 'training' ? '複数検定員モード' : '複数審判モード';
</script>

<div class="settings-section">
	<h3 class="settings-title">{title}</h3>

	{#if settingsSuccess}
		<div class="success-message">{settingsSuccess}</div>
	{/if}

	{#if settingsError}
		<div class="error-message">{settingsError}</div>
	{/if}

	{#if isChief}
		<form
			method="POST"
			action={action}
			use:enhance={() => {
				isSaving = true;
				return async ({ update }) => {
					await update({ reset: false });
					isSaving = false;
				};
			}}
		>
			<div class="setting-item">
				<label for={toggleId} class="form-label">{toggleLabel}</label>
				<div class="toggle-switch">
					<input
						type="checkbox"
						id={toggleId}
						name="isMultiJudge"
						bind:checked={localIsMultiJudge}
						value={localIsMultiJudge}
					/>
					<label for={toggleId}></label>
				</div>
			</div>

			<div class="info-box">
				{#if localIsMultiJudge}
					<p><strong>ON:</strong> 主任検定員が採点指示を出し、全検定員が同じ選手・種目を採点します</p>
				{:else}
					<p><strong>OFF:</strong> 各検定員が自由に選手・種目を選んで採点できます</p>
				{/if}
			</div>

			{#if mode === 'certification' && localIsMultiJudge}
				<div class="setting-item">
					<label for="required-judges-input" class="form-label">
						必須審判員数
						<span class="helper-text">(現在: {participantCount}人)</span>
					</label>
					<input
						type="number"
						id="required-judges-input"
						name="requiredJudges"
						bind:value={localRequiredJudges}
						min="1"
						max={participantCount}
						class="short-input"
					/>
				</div>
			{/if}

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
	{:else}
		<div class="setting-item">
			<span class="form-label">{toggleLabel}</span>
			<div class="readonly-value">
				{localIsMultiJudge ? 'ON' : 'OFF'}
			</div>
		</div>

		<div class="info-box">
			{#if localIsMultiJudge}
				<p><strong>ON:</strong> 主任検定員が採点指示を出し、全検定員が同じ選手・種目を採点します</p>
			{:else}
				<p><strong>OFF:</strong> 各検定員が自由に選手・種目を選んで採点できます</p>
			{/if}
		</div>

		{#if mode === 'certification' && localIsMultiJudge}
			<div class="setting-item">
				<span class="form-label">必須審判員数</span>
				<div class="readonly-value">{localRequiredJudges}人</div>
			</div>
		{/if}

		<p class="readonly-notice">※ 設定の変更は主任検定員のみ可能です</p>
	{/if}
</div>

<style>
	.settings-section {
		margin-bottom: 1.5rem;
		text-align: left;
	}
	.settings-title {
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 0.5rem;
		display: block;
		text-align: left;
	}
	.form-label {
		font-size: 17px;
		font-weight: 600;
		display: block;
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
	.setting-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
		background: white;
		padding: 12px 16px;
		border-radius: 12px;
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
	.helper-text {
		font-size: 14px;
		font-weight: 400;
		color: var(--secondary-text);
		margin-left: 8px;
	}
	.short-input {
		width: 70px;
		padding: 10px !important;
		text-align: center;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		font-size: 16px;
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

	@media (min-width: 768px) {
		.settings-title {
			font-size: 20px;
		}
		.form-label {
			font-size: 20px;
		}
	}
</style>
