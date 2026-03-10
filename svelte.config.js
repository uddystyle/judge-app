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
		},

		// Content Security Policy
		// NOTE: 現在は hooks.server.ts で手動設定しているため、ここではコメントアウト
		// 将来的にはこちらに移行してNonce-based CSPを実装する予定
		// csp: {
		// 	mode: 'auto',
		// 	directives: {
		// 		'script-src': ['self', 'https://js.stripe.com'],
		// 		'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
		// 		'font-src': ['self', 'https://fonts.gstatic.com'],
		// 		'img-src': ['self', 'data:', 'https:', 'blob:'],
		// 		'connect-src': ['self', 'https://*.supabase.co', 'https://api.stripe.com', 'wss://*.supabase.co'],
		// 		'frame-src': ['https://js.stripe.com'],
		// 		'frame-ancestors': ['none'],
		// 		'base-uri': ['self'],
		// 		'form-action': ['self']
		// 	}
		// }
	}
};

export default config;
