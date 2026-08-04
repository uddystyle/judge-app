import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from 'vite';

// SETUP.md どおり .env.test を置けばE2Eから利用できるようにする。
// シェルやCIで明示された値は上書きしない。
const testEnv = loadEnv('test', process.cwd(), '');
for (const [key, value] of Object.entries(testEnv)) {
	process.env[key] ??= value;
}

/**
 * Playwright E2Eテスト設定
 *
 * 複数検定員のリアルタイム機能をテストします。
 */
export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: false, // 複数検定員のテストは順序が重要なので並列実行しない
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : 1,
	reporter: 'html',
	use: {
		baseURL: process.env.BASE_URL || 'http://localhost:5173',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},

	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],

	// 開発サーバーを自動起動（オプション）
	webServer: process.env.CI
		? undefined
		: {
				command: 'npm run dev',
				url: 'http://localhost:5173',
				reuseExistingServer: !process.env.CI,
				timeout: 120 * 1000
			}
});
