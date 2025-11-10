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
				drop_debugger: true
			}
		},
		// チャンクサイズの最適化
		rollupOptions: {
			output: {
				manualChunks: {
					// 大きなライブラリを個別のチャンクに分割
					'supabase': ['@supabase/supabase-js', '@supabase/ssr']
				}
			}
		},
		// チャンクサイズ警告の閾値を調整
		chunkSizeWarningLimit: 1000
	},
	// プリロード最適化
	ssr: {
		noExternal: ['@supabase/ssr', '@supabase/supabase-js']
	}
});
