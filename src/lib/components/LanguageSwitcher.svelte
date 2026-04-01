<script lang="ts">
	import { getLocale, setLocale, locales } from '$lib/paraglide/runtime.js';

	const locale = getLocale();

	function switchLocale(newLocale: string) {
		if (newLocale !== locale) {
			setLocale(newLocale as 'ja' | 'en');
		}
	}
</script>

<div class="language-switcher">
	{#each locales as loc}
		<button
			class="lang-btn"
			class:active={locale === loc}
			onclick={() => switchLocale(loc)}
			aria-label="Switch to {loc === 'ja' ? '日本語' : 'English'}"
		>
			{loc === 'ja' ? 'JA' : 'EN'}
		</button>
	{/each}
</div>

<style>
	.language-switcher {
		display: flex;
		gap: 2px;
		background: var(--bg-tertiary, #f0f0f0);
		border-radius: 6px;
		padding: 2px;
	}

	.lang-btn {
		padding: 4px 8px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--text-secondary, #666);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		line-height: 1;
	}

	.lang-btn:hover {
		color: var(--text-primary, #333);
	}

	.lang-btn.active {
		background: var(--bg-primary, #fff);
		color: var(--text-primary, #333);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}
</style>
