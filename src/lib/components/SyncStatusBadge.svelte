<script lang="ts">
	import {
		pendingCount,
		rejectedCount,
		syncing,
		lastSyncedAt,
		isOffline
	} from '$lib/offline/syncStatus';

	// 採点画面用の同期状態表示（network-resilience-strategy.md Phase 3）
	// 表示ポリシー: 通常時（オンライン・未同期0）は何も出さない。
	// 異常・待機がある時だけ出して、現場の不安を減らす。

	function formatTime(date: Date): string {
		return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
	}
</script>

{#if $isOffline || $pendingCount > 0 || $rejectedCount > 0}
	<div class="sync-status" role="status">
		{#if $isOffline}
			<span class="badge offline">オフライン</span>
			<span class="text">採点は端末に保存され、通信が復帰すると自動同期されます</span>
		{:else if $syncing}
			<span class="badge pending">同期中…</span>
			<span class="text">未同期 {$pendingCount}件を送信しています</span>
		{:else if $pendingCount > 0}
			<span class="badge pending">未同期 {$pendingCount}件</span>
			<span class="text">
				端末に保存済みです
				{#if $lastSyncedAt}（最終同期 {formatTime($lastSyncedAt)}）{/if}
			</span>
		{/if}
		{#if $rejectedCount > 0}
			<span class="badge rejected">同期失敗 {$rejectedCount}件</span>
			<span class="text">お手数ですが運営にお問い合わせください</span>
		{/if}
	</div>
{/if}

<style>
	.sync-status {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 6px 10px;
		margin: 8px 16px;
		padding: 8px 12px;
		border-radius: 10px;
		background: var(--bg-secondary);
		font-size: 13px;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 10px;
		border-radius: 999px;
		font-weight: 600;
		font-size: 12px;
		white-space: nowrap;
	}
	.badge.offline {
		background: var(--color-warning-tint);
		color: var(--color-warning);
	}
	.badge.pending {
		background: var(--accent-tint);
		color: var(--accent);
	}
	.badge.rejected {
		background: var(--color-error-tint);
		color: var(--color-error);
	}
	.text {
		color: var(--text-secondary);
		line-height: 1.5;
	}
</style>
