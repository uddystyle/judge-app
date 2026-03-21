<script lang="ts">
	import { enhance, applyAction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';

	export let scores: Array<{
		judge_name: string;
		score: number;
		judge_id?: string;
		guest_identifier?: string;
	}> = [];
	export let isChief: boolean = false;
	export let requiredJudges: number = 1;
	export let canSubmit: boolean = false;
	/** Whether to highlight max/min scores (e.g. for 5審3採 tournament mode) */
	export let highlightExtremes: boolean = false;

	/** Hidden field values for the correction form */
	export let bib: string = '';
	/** Form action URL prefix (e.g. "?" or "") */
	export let actionBase: string = '?';
	/** Callback after successful correction */
	export let onCorrectionSuccess: ((judgeName: string) => void) | null = null;

	function isMaxScore(score: number, allScores: typeof scores): boolean {
		if (!allScores || allScores.length === 0) return false;
		const max = Math.max(...allScores.map((s) => Number(s.score)));
		return Number(score) === max;
	}

	function isMinScore(score: number, allScores: typeof scores): boolean {
		if (!allScores || allScores.length === 0) return false;
		const min = Math.min(...allScores.map((s) => Number(s.score)));
		return Number(score) === min;
	}

	const handleSubmit: SubmitFunction = ({ formData }) => {
		const judgeName = formData.get('judgeName') as string;
		return async ({ result, update }) => {
			if (result.type === 'success') {
				// Re-run load functions so the page receives fresh data
				await invalidateAll();
				if (onCorrectionSuccess) {
					onCorrectionSuccess(judgeName);
				}
			} else {
				// For failure/error/redirect, let SvelteKit handle natively
				await applyAction(result);
			}
		};
	};
</script>

<h3 class="settings-title">各検定員の得点</h3>
<div class="participants-container">
	{#if scores && scores.length > 0}
		{#each scores as s}
			<div class="participant-item">
				<div class="participant-info">
					<span class="participant-name">{s.judge_name}</span>
					<span
						class="score-value"
						class:max-score={highlightExtremes && isChief && isMaxScore(s.score, scores)}
						class:min-score={highlightExtremes && isChief && isMinScore(s.score, scores)}
					>
						{s.score} 点
					</span>
				</div>
				{#if isChief}
					<form method="POST" action="{actionBase}/requestCorrection" use:enhance={handleSubmit}>
						<input type="hidden" name="bib" value={bib} />
						<input type="hidden" name="judgeName" value={s.judge_name} />
						<input type="hidden" name="judgeId" value={s.judge_id || ''} />
						<input type="hidden" name="guestIdentifier" value={s.guest_identifier || ''} />
						<button type="submit" class="correction-btn">
							修正
						</button>
					</form>
				{/if}
			</div>
		{/each}
	{:else}
		<p>採点結果を待っています...</p>
	{/if}
</div>

{#if isChief}
	<div class="status-count">
		<p>
			現在の採点者数: <strong>{scores?.length || 0} / {requiredJudges} 人</strong>
		</p>
	</div>
{/if}

<style>
	.settings-title {
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 0.5rem;
		text-align: left;
	}
	.participants-container {
		background: white;
		border-radius: 12px;
		padding: 8px 16px;
		min-height: 100px;
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
	.participant-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex: 1;
	}
	.participant-name {
		font-weight: 500;
	}
	.score-value {
		font-size: 18px;
		font-weight: 600;
		color: var(--ios-blue);
		margin-left: auto;
	}
	.score-value.max-score {
		color: #d32f2f;
		font-weight: 700;
	}
	.score-value.min-score {
		color: #1976d2;
		font-weight: 700;
	}
	.correction-btn {
		background: var(--ios-orange);
		color: white;
		border: none;
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.2s;
		margin-left: 16px;
	}
	.correction-btn:active {
		opacity: 0.7;
	}
	.status-count {
		color: var(--secondary-text);
		margin-top: 20px;
	}
</style>
