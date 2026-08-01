<script lang="ts">
	import { onMount } from 'svelte';

	// iOS Safari 向けのホーム画面追加案内（network-resilience-strategy.md「iOS Safari の制約」）
	// ITP により未インストールのサイトは IndexedDB が最終利用から7日で削除されうるため、
	// オフライン採点を確実にするにはホーム画面追加が実質必須。
	// ホーム画面から起動済み（standalone）または非 iOS では表示しない。

	const DISMISS_KEY = 'tento-ios-install-hint-dismissed';

	let visible = false;

	onMount(() => {
		try {
			if (localStorage.getItem(DISMISS_KEY)) return;

			const ua = navigator.userAgent;
			const isIos =
				/iP(hone|ad|od)/.test(ua) ||
				// iPadOS 13+ は Mac として名乗るため touch で判定
				(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
			const isStandalone =
				('standalone' in navigator &&
					(navigator as { standalone?: boolean }).standalone === true) ||
				window.matchMedia('(display-mode: standalone)').matches;

			visible = isIos && !isStandalone;
		} catch {
			visible = false;
		}
	});

	function dismiss() {
		visible = false;
		try {
			localStorage.setItem(DISMISS_KEY, '1');
		} catch {
			// localStorage 不可（プライベートブラウズ等）でも表示だけ消す
		}
	}
</script>

{#if visible}
	<div class="ios-hint" role="note">
		<span class="ios-hint-text">
			iOS
			では共有メニューから「ホーム画面に追加」すると、電波の弱い場所でも採点データの端末保存がより確実になります。
		</span>
		<button type="button" class="ios-hint-close" on:click={dismiss} aria-label="閉じる">×</button>
	</div>
{/if}

<style>
	.ios-hint {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin: 8px 16px;
		padding: 10px 12px;
		border-radius: 10px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-light);
	}
	.ios-hint-text {
		flex: 1;
		font-size: 12px;
		color: var(--text-secondary);
		line-height: 1.6;
	}
	.ios-hint-close {
		flex: none;
		background: none;
		border: none;
		color: var(--text-secondary);
		font-size: 16px;
		line-height: 1;
		padding: 2px 6px;
		cursor: pointer;
	}
</style>
