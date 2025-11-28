import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	build: {
		cssCodeSplit: true,
		minify: 'terser',
		terserOptions: {
			compress: {
				drop_console: true,
				drop_debugger: true,
				passes: 2 // 追加の圧縮パス
			},
			mangle: true
		},
		// チャンクサイズの最適化
		rollupOptions: {
			output: {
				manualChunks: (id) => {
					// 大きなライブラリを個別のチャンクに分割
					if (id.includes('@supabase')) {
						return 'supabase';
					}
					if (id.includes('stripe')) {
						return 'stripe';
					}
					if (id.includes('xlsx')) {
						return 'xlsx';
					}
					if (id.includes('qrcode')) {
						return 'qrcode';
					}
					// node_modulesは別チャンクに
					if (id.includes('node_modules')) {
						return 'vendor';
					}
				}
			}
		},
		// チャンクサイズ警告の閾値を調整
		chunkSizeWarningLimit: 1000,
		// 圧縮設定
		reportCompressedSize: false, // ビルド速度向上
		target: 'es2020' // モダンブラウザ向けに最適化
	},
	// プリロード最適化
	ssr: {
		noExternal: ['@supabase/ssr', '@supabase/supabase-js']
	},
	// 開発サーバーの最適化
	server: {
		fs: {
			strict: true
		}
	}
});
