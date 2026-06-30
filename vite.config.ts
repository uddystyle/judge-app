import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['cookie', 'baseLocale']
		})
	],
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
	// 重いCJS依存を dev 起動時に事前バンドルする。
	// xlsx は details ページ、qrcode は QRInviteModal でのみ import されるため、
	// 該当ページを初めて開いた時に Vite がオンデマンドで依存を再最適化し、
	// 既に読み込み済みの最適化チャンク(?v=ハッシュ)が 504 "Outdated Optimize Dep" になって
	// client/app.js の動的 import が失敗 → ハイドレーションされず全ボタン/リンクが効かなくなる
	// （ブラウザが古いハッシュをキャッシュしているため Chrome だけ等のブラウザ依存で出る）。
	// 起動時にまとめて事前最適化し、セッション途中の再最適化を防ぐ。
	optimizeDeps: {
		include: ['xlsx', 'qrcode']
	},
	// 開発サーバーの最適化
	server: {
		fs: {
			strict: true
		}
	}
});
