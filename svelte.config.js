import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// Vercel用に最適化されたアダプター
		adapter: adapter({
			runtime: 'nodejs20.x',
			regions: ['hnd1'], // Tokyo region for optimal performance
			maxDuration: 10
		}),

		// プリロード戦略の最適化
		prerender: {
			// 完全に静的なページのみプリレンダリング（認証状態に依存しないページ）
			entries: ['/pricing', '/faq', '/privacy', '/terms', '/legal', '/contact']
		}
	}
};

export default config;
