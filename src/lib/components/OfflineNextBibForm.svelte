<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { findCachedParticipant, type CachedParticipant } from '$lib/offline/sessionCache';

	// オフライン採点の「次の選手」継続フォーム（単独審判専用。多審制は prompt 進行が
	// サーバー必須のため親側で出さない）。ゼッケンを入力するとキャッシュ済み参加者を照合し、
	// confirm イベントで親に返す。requireRegistered の場合（大会/研修）は
	// キャッシュに居ないゼッケンを拒否する（同期 API が participant_not_found で
	// 恒久拒否するため、送れない採点を作らない）。

	export let sessionId: number;
	/** true: キャッシュ済み参加者のみ許可（大会/研修）。false: 任意の1-999（検定=同期側で自動作成） */
	export let requireRegistered = false;
	/** フォーム展開状態。親が bind して「入力途中に自動クリアで消える」のを防ぐ */
	export let open = false;

	const dispatch = createEventDispatcher<{
		confirm: { bib: number; participant: CachedParticipant | null };
	}>();

	let bibValue: number | null = null;
	let errorMessage = '';

	async function confirm() {
		const bib = bibValue;
		if (!Number.isInteger(bib) || bib === null || bib < 1 || bib > 999) {
			errorMessage = 'ゼッケン番号は1〜999で入力してください。';
			return;
		}
		const participant = await findCachedParticipant(sessionId, bib);
		if (requireRegistered && !participant) {
			errorMessage =
				'このゼッケンの参加者が見つかりません。オフライン中は事前に登録済みのゼッケンのみ採点できます。';
			return;
		}
		errorMessage = '';
		open = false;
		bibValue = null;
		dispatch('confirm', { bib, participant });
	}
</script>

{#if !open}
	<button type="button" class="next-bib-open" on:click={() => (open = true)}>
		次の選手を採点する
	</button>
{:else}
	<div class="next-bib-form">
		<input
			type="number"
			inputmode="numeric"
			min="1"
			max="999"
			placeholder="ゼッケン番号"
			bind:value={bibValue}
			on:keydown={(e) => e.key === 'Enter' && confirm()}
		/>
		<button type="button" class="next-bib-confirm" on:click={confirm}>決定</button>
	</div>
	{#if errorMessage}
		<div class="next-bib-error">{errorMessage}</div>
	{/if}
{/if}

<style>
	.next-bib-open {
		display: block;
		margin: 10px auto 0;
		padding: 8px 20px;
		border: 1px solid var(--color-success);
		border-radius: 8px;
		background: none;
		color: var(--color-success);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}
	.next-bib-form {
		display: flex;
		justify-content: center;
		gap: 8px;
		margin-top: 10px;
	}
	.next-bib-form input {
		width: 120px;
		padding: 8px 10px;
		border: 1px solid var(--border-light);
		border-radius: 8px;
		font-size: 16px;
		text-align: center;
	}
	.next-bib-confirm {
		padding: 8px 16px;
		border: none;
		border-radius: 8px;
		background: var(--color-success);
		color: var(--text-on-accent);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}
	.next-bib-error {
		margin-top: 8px;
		color: var(--color-error);
		font-size: 13px;
	}
</style>
