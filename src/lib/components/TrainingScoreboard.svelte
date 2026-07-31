<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';

	// 研修モードの採点結果一覧（details ページから抽出した表示専用コンポーネント）
	interface TrainingScore {
		score: number;
		training_events?: { name?: string } | null;
		athlete?: { bib_number?: number; profiles?: { full_name?: string } | null } | null;
		judge?: { full_name?: string } | null;
	}

	export let scores: TrainingScore[];
</script>

<div class="scoreboard">
	<div class="scoreboard-header">
		<div class="col-event">{m.details_event()}</div>
		<div class="col-athlete">{m.details_athlete()}</div>
		<div class="col-judge">{m.details_judge()}</div>
		<div class="col-score">{m.details_score()}</div>
	</div>
	{#each scores as score, i (i)}
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
			<div class="col-score">{m.details_scorePoints({ score: String(score.score) })}</div>
		</div>
	{/each}
</div>

<style>
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
		background: var(--bg-secondary);
		font-weight: 600;
		border-bottom: 2px solid var(--separator-gray);
	}

	.scoreboard-row {
		border-bottom: 1px solid var(--border-light);
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
		color: var(--color-warning);
	}

	.athlete-name {
		display: block;
		font-size: 12px;
		color: var(--text-secondary);
		margin-top: 2px;
	}
</style>
