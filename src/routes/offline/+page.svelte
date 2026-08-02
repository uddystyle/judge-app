<script lang="ts">
	import { pendingCount, isOffline } from '$lib/offline/syncStatus';

	// Service Worker のオフライン fallback ページ。
	// ページ遷移がネットワーク到達不能だった時だけ表示される（プリレンダー+precache）。
	// 自動同期はルートレイアウトの startOfflineSync が常駐している。

	function retry() {
		location.reload();
	}
</script>

<svelte:head>
	<title>オフライン - TENTO</title>
</svelte:head>

<div class="offline-page">
	<div class="offline-icon" aria-hidden="true">📡</div>
	<h1>オフラインです</h1>
	<p class="offline-description">
		ページを読み込めませんでした。通信状態をご確認のうえ、もう一度お試しください。
	</p>

	{#if $pendingCount > 0}
		<div class="offline-pending">
			未同期の採点が {$pendingCount} 件、端末に保存されています。<br />
			通信が復帰すると自動的に同期されます。データは失われません。
		</div>
	{/if}

	<button type="button" class="offline-retry" on:click={retry}>
		{$isOffline ? '再読み込み' : '再読み込み（オンラインに戻りました）'}
	</button>

	<p class="offline-hint">
		採点中に電波が切れた場合は、採点画面を開いたままにすると「次の選手を採点する」から採点を続けられます。
	</p>
</div>

<style>
	.offline-page {
		max-width: 480px;
		margin: 0 auto;
		padding: 64px 24px;
		text-align: center;
	}
	.offline-icon {
		font-size: 48px;
		margin-bottom: 16px;
	}
	h1 {
		font-size: 22px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 12px;
	}
	.offline-description {
		font-size: 14px;
		color: var(--text-secondary);
		line-height: 1.7;
		margin: 0 0 20px;
	}
	.offline-pending {
		background: var(--color-success-tint);
		border: 1px solid var(--color-success);
		color: var(--color-success);
		border-radius: 10px;
		padding: 14px;
		font-size: 14px;
		line-height: 1.7;
		margin-bottom: 20px;
	}
	.offline-retry {
		padding: 12px 28px;
		border: none;
		border-radius: 10px;
		background: var(--accent);
		color: var(--text-on-accent);
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
	}
	.offline-retry:active {
		background: var(--accent-active);
	}
	.offline-hint {
		margin-top: 24px;
		font-size: 12px;
		color: var(--text-secondary);
		line-height: 1.7;
	}
</style>
