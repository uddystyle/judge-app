<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';

	export let isChief: boolean;
	export let participantCount: number;
	export let initialExcludeExtremes: boolean;
	export let initialMaxScoreDiff: number | null;
	export let tournamentSettingsSuccess: string | undefined = undefined;
	export let tournamentSettingsError: string | undefined = undefined;

	let selectedMethod: '3judges' | '5judges' = initialExcludeExtremes ? '5judges' : '3judges';
	let enableScoreDiffControl = initialMaxScoreDiff !== null;
	let maxScoreDiff = initialMaxScoreDiff || 2;
	let isSaving = false;

	$: canUse3Judges = participantCount === 3;
	$: canUse5Judges = participantCount === 5;

	$: if (!canUse5Judges && selectedMethod === '5judges') {
		if (canUse3Judges) {
			selectedMethod = '3judges';
		}
	}
	$: if (!canUse3Judges && selectedMethod === '3judges') {
		if (canUse5Judges) {
			selectedMethod = '5judges';
		}
	}
</script>

<div class="settings-section">
	<h3 class="settings-title">{m.settings_scoringMethod()}</h3>

	{#if tournamentSettingsSuccess}
		<div class="success-message">{tournamentSettingsSuccess}</div>
	{/if}

	{#if tournamentSettingsError}
		<div class="error-message">{tournamentSettingsError}</div>
	{/if}

	{#if isChief}
		<form
			method="POST"
			action="?/updateTournamentSettings"
			use:enhance={() => {
				isSaving = true;
				return async ({ update }) => {
					await update({ reset: false });
					isSaving = false;
				};
			}}
		>
			{#if !canUse3Judges && !canUse5Judges}
				<div class="error-message">
					{m.settings_needJudges({ count: String(participantCount) })}
				</div>
			{/if}

			<div class="scoring-options">
				<label class="scoring-option" class:selected={selectedMethod === '3judges'} class:disabled={!canUse3Judges}>
					<input type="radio" name="scoringMethod" value="3judges" bind:group={selectedMethod} disabled={!canUse3Judges} />
					<div class="option-content">
						<div class="option-header">
							<span class="option-title">{m.settings_3judge3score()}</span>
							{#if !canUse3Judges}
								<span class="required-badge">{m.settings_need3judges()}</span>
							{/if}
						</div>
						<div class="option-description">{m.settings_3judgeDesc()}</div>
						<div class="option-example">{m.settings_3judgeExample()}</div>
					</div>
				</label>

				<label class="scoring-option" class:selected={selectedMethod === '5judges'} class:disabled={!canUse5Judges}>
					<input type="radio" name="scoringMethod" value="5judges" bind:group={selectedMethod} disabled={!canUse5Judges} />
					<div class="option-content">
						<div class="option-header">
							<span class="option-title">{m.settings_5judge3score()}</span>
							{#if !canUse5Judges}
								<span class="required-badge">{m.settings_need5judges()}</span>
							{/if}
						</div>
						<div class="option-description">
							{m.settings_5judgeDesc()}
						</div>
						<div class="option-example">
							{@html m.settings_5judgeExample()}
						</div>
					</div>
				</label>
			</div>

			<div class="score-diff-section">
				<h4 class="subsection-title">{m.settings_scoreDiffControl()}</h4>

				<div class="score-diff-toggle">
					<input
						type="checkbox"
						id="enableScoreDiffControl"
						name="enableScoreDiffControl"
						bind:checked={enableScoreDiffControl}
					/>
					<label for="enableScoreDiffControl">{m.settings_enableScoreDiff()}</label>
				</div>

				{#if enableScoreDiffControl}
					<div class="score-diff-input-group">
						<label for="maxScoreDiff" class="input-label">{m.settings_maxScoreDiff()}</label>
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
							<span class="unit">{m.settings_scoreDiffUnit()}</span>
						</div>
						<p class="help-text">
							{m.settings_scoreDiffHelp()}
						</p>
					</div>
				{/if}
			</div>

			<div class="form-actions">
				<button type="submit" class="save-btn" disabled={!canUse3Judges && !canUse5Judges || isSaving}>
					{#if isSaving}
						<span class="loading-spinner"></span>
						{m.settings_saving()}
					{:else}
						{m.settings_save()}
					{/if}
				</button>
			</div>
		</form>
	{:else}
		<div class="readonly-scoring-method">
			<div class="method-display">
				<div class="method-title">
					{selectedMethod === '5judges' ? m.settings_5judge3score() : m.settings_3judge3score()}
				</div>
				<div class="method-description">
					{#if selectedMethod === '5judges'}
						{m.settings_5judgeDesc()}
					{:else}
						{m.settings_3judgeDesc()}
					{/if}
				</div>
			</div>
		</div>
		<p class="readonly-notice">{m.settings_scoringMethodChiefOnly()}</p>
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
	/* Used inside {@html} block - scoped via parent */
	.option-example :global(.excluded) {
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
	.readonly-notice {
		font-size: 14px;
		color: #666;
		font-style: italic;
		margin-top: 12px;
		text-align: center;
	}
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

	@media (min-width: 768px) {
		.settings-title {
			font-size: 20px;
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
	}
	@media (max-width: 768px) {
		.score-diff-section {
			padding: 16px;
		}
		.subsection-title {
			font-size: 16px;
		}
	}
</style>
