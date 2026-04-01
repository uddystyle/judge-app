<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import * as m from '$lib/paraglide/messages.js';

	// アンカーリンク付きで遷移する関数
	async function navigateWithAnchor(path: string) {
		// パスとアンカーを分離
		const [basePath, anchor] = path.split('#');

		// ページ遷移（トップページの場合、view=landingパラメータを追加してリダイレクトを回避）
		const targetPath = basePath === '/' ? '/?view=landing' : basePath || '/';
		await goto(targetPath);

		// アンカーがある場合、少し待ってからスクロール
		if (anchor && browser) {
			setTimeout(() => {
				const element = document.getElementById(anchor);
				if (element) {
					element.scrollIntoView({ behavior: 'smooth', block: 'start' });
				}
			}, 100);
		}
	}
</script>

<footer class="footer">
	<div class="footer-container">
		<div class="footer-brand">
			<button class="brand-name" on:click={() => goto('/?view=landing')}>TENTO</button>
			<p class="brand-description">{m.footer_description()}</p>
		</div>

		<div class="footer-links">
			<div class="footer-column">
				<h4 class="column-title">{m.footer_product()}</h4>
				<ul class="link-list">
					<li><button class="link-button" on:click={() => navigateWithAnchor('/#features')}>{m.footer_features()}</button></li>
					<li><button class="link-button" on:click={() => goto('/pricing')}>{m.footer_pricing()}</button></li>
					<li>
						<button class="link-button" on:click={() => navigateWithAnchor('/#how-it-works')}>{m.footer_howToUse()}</button>
					</li>
				</ul>
			</div>

			<div class="footer-column">
				<h4 class="column-title">{m.footer_support()}</h4>
				<ul class="link-list">
					<li><button class="link-button" on:click={() => goto('/contact')}>{m.footer_contact()}</button></li>
					<li><button class="link-button" on:click={() => goto('/faq')}>{m.footer_faq()}</button></li>
				</ul>
			</div>

			<div class="footer-column">
				<h4 class="column-title">{m.footer_legal()}</h4>
				<ul class="link-list">
					<li><button class="link-button" on:click={() => goto('/terms')}>{m.footer_terms()}</button></li>
					<li><button class="link-button" on:click={() => goto('/privacy')}>{m.footer_privacy()}</button></li>
					<li><button class="link-button" on:click={() => goto('/legal')}>{m.footer_commercialLaw()}</button></li>
				</ul>
			</div>
		</div>
	</div>

	<div class="footer-bottom">
		<p class="copyright">© 2025 TENTO. All rights reserved.</p>
	</div>
</footer>

<style>
	.footer {
		background: var(--bg-primary);
		color: var(--text-primary);
		padding: 60px 20px 24px;
		margin-top: 80px;
		border-top: 1px solid var(--border-light);
	}

	.footer-container {
		max-width: 1200px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: 1fr;
		gap: 48px;
	}

	.footer-brand {
		margin-bottom: 0;
	}

	.brand-name {
		font-family: 'M PLUS Rounded 1c', sans-serif;
		font-size: 32px;
		font-weight: 800;
		color: var(--text-primary);
		margin-bottom: 12px;
		letter-spacing: 0.05em;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.brand-name:hover {
		color: var(--text-secondary);
		transform: scale(1.02);
	}

	.brand-name:active {
		transform: scale(0.98);
	}

	.brand-description {
		font-size: 15px;
		color: var(--text-secondary);
		line-height: 1.7;
		max-width: 360px;
		letter-spacing: -0.01em;
	}

	.footer-links {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 40px;
	}

	.footer-column {
		min-width: 0;
	}

	.column-title {
		font-size: 14px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 20px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.link-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.link-list li {
		margin-bottom: 14px;
	}

	.link-button {
		background: none;
		border: none;
		color: var(--text-secondary);
		font-size: 15px;
		cursor: pointer;
		padding: 0;
		text-align: left;
		transition: all 0.15s ease;
		font-family: inherit;
		position: relative;
		letter-spacing: -0.01em;
	}

	.link-button:hover {
		color: var(--text-primary);
		transform: translateX(2px);
	}

	.footer-bottom {
		max-width: 1200px;
		margin: 48px auto 0;
		padding-top: 24px;
		border-top: 1px solid var(--border-light);
		text-align: center;
	}

	.copyright {
		font-size: 13px;
		color: var(--text-muted);
		margin: 0;
		font-weight: 500;
		letter-spacing: -0.01em;
	}

	/* タブレット以上 */
	@media (min-width: 768px) {
		.footer {
			padding: 80px 40px 32px;
			margin-top: 100px;
		}

		.footer-container {
			grid-template-columns: 1.5fr 2.5fr;
			gap: 80px;
			align-items: start;
		}

		.brand-name {
			font-size: 36px;
		}

		.brand-name:hover {
			color: var(--text-secondary);
		}

		.brand-description {
			font-size: 16px;
		}

		.footer-links {
			grid-template-columns: repeat(3, 1fr);
			gap: 48px;
		}

		.column-title {
			font-size: 13px;
			margin-bottom: 24px;
		}

		.link-button {
			font-size: 15px;
		}

		.copyright {
			font-size: 14px;
		}
	}

	/* デスクトップ */
	@media (min-width: 1024px) {
		.footer {
			padding: 100px 40px 40px;
		}

		.footer-links {
			gap: 64px;
		}
	}
</style>
