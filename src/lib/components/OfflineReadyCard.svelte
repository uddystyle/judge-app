<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getCachedSessionBundle,
		refreshSessionCache,
		type CachedSessionBundle
	} from '$lib/offline/sessionCache';

	// 「このセッションをオフライン利用可能にする」導線（戦略文書 Phase 4）。
	// マウント時にオンラインなら自動更新し、手動更新ボタンも提供する。

	export let sessionId: number;
	export let guestIdentifier: string | null = null;

	let bundle: CachedSessionBundle | undefined;
	let refreshing = false;
	let refreshFailed = false;

	function formatCachedAt(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		return date.toLocaleString('ja-JP', {
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	async function refresh() {
		refreshing = true;
		refreshFailed = false;
		const result = await refreshSessionCache(sessionId, { guestIdentifier });
		if (result) {
			bundle = result;
		} else {
			refreshFailed = true;
		}
		refreshing = false;
	}

	onMount(async () => {
		bundle = await getCachedSessionBundle(sessionId).catch(() => undefined);
		if (navigator.onLine !== false) {
			await refresh();
		}
	});
</script>

<div class="offline-ready-card">
	<div class="offline-ready-text">
		<span class="offline-ready-title">オフライン利用の準備</span>
		{#if bundle}
			<span class="offline-ready-status">
				保存済み（{formatCachedAt(bundle.cached_at)} / 参加者 {bundle.participants.length}名）
			</span>
		{:else}
			<span class="offline-ready-status"
				>未保存 — 電波の弱い会場に備えてデータを端末に保存できます</span
			>
		{/if}
		{#if refreshFailed}
			<span class="offline-ready-error">更新できませんでした（通信状態をご確認ください）</span>
		{/if}
	</div>
	<button type="button" class="offline-ready-button" on:click={refresh} disabled={refreshing}>
		{refreshing ? '保存中…' : bundle ? '今すぐ更新' : 'データを保存'}
	</button>
</div>

<style>
	.offline-ready-card {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 8px 16px;
		padding: 10px 12px;
		border-radius: 10px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-light);
	}
	.offline-ready-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.offline-ready-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.offline-ready-status {
		font-size: 12px;
		color: var(--text-secondary);
		line-height: 1.5;
	}
	.offline-ready-error {
		font-size: 12px;
		color: var(--color-error);
	}
	.offline-ready-button {
		flex: none;
		padding: 8px 14px;
		border: 1px solid var(--accent);
		border-radius: 8px;
		background: none;
		color: var(--accent);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.offline-ready-button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
