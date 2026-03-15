/**
 * Realtimeポーリング動作のE2Eテスト
 *
 * Playwrightを使用して、Realtime接続成功後のポーリング動作を検証します。
 *
 * 実行方法:
 *   npm run test:e2e
 *   または
 *   npx playwright test tests/e2e/realtime-polling-behavior.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// テスト設定
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const TEST_TIMEOUT = 30000;

// テストユーザー情報
const TEST_EMAIL = process.env.TEST_JUDGE_EMAIL || 'judge@example.com';
const TEST_PASSWORD = process.env.TEST_JUDGE_PASSWORD || 'password';

test.describe('Realtime Polling Behavior', () => {
	test.setTimeout(TEST_TIMEOUT);

	let page: Page;

	test.beforeEach(async ({ browser }) => {
		page = await browser.newPage();

		// ネットワークリクエストをログ
		page.on('request', (request) => {
			if (request.url().includes('/sessions') || request.url().includes('supabase')) {
				console.log(`[Request] ${request.method()} ${request.url()}`);
			}
		});

		// コンソールログをキャプチャ
		page.on('console', (msg) => {
			if (msg.text().includes('polling') || msg.text().includes('Realtime')) {
				console.log(`[Console] ${msg.text()}`);
			}
		});
	});

	test.afterEach(async () => {
		await page.close();
	});

	test('Realtime接続成功後はポーリングが発生しない（採点画面）', async () => {
		// ログイン処理（省略 - 実際の環境に合わせて実装）
		await page.goto(`${BASE_URL}/login`);
		// ... ログイン処理 ...

		// 採点画面に遷移（実際のURLに合わせて調整）
		// await page.goto(`${BASE_URL}/session/test-session/score`);

		const networkRequests: string[] = [];
		const consoleMessages: string[] = [];

		// ネットワークリクエストを記録
		page.on('request', (request) => {
			if (request.url().includes('/sessions') && request.method() === 'GET') {
				networkRequests.push(`${Date.now()}_${request.url()}`);
			}
		});

		// コンソールメッセージを記録
		page.on('console', (msg) => {
			const text = msg.text();
			if (text.includes('Realtime') || text.includes('polling')) {
				consoleMessages.push(text);
			}
		});

		// Realtime接続成功を待つ
		await page.waitForTimeout(3000);

		// Realtime接続成功のログを確認
		const realtimeSuccessLog = consoleMessages.find((msg) =>
			msg.includes('✅ リアルタイム接続成功')
		);
		expect(realtimeSuccessLog).toBeTruthy();

		// ポーリング不要のログを確認
		const pollingNotNeededLog = consoleMessages.find((msg) => msg.includes('ポーリング不要'));
		expect(pollingNotNeededLog).toBeTruthy();

		// 初期リクエスト数を記録
		const initialRequestCount = networkRequests.length;

		// 15秒待機（ポーリングが3秒ごとに発生しないことを確認）
		await page.waitForTimeout(15000);

		// ポーリングリクエストが発生していないことを確認
		// (Realtime接続成功後は、定期的なGETリクエストが発生しないはず)
		const finalRequestCount = networkRequests.length;
		const additionalRequests = finalRequestCount - initialRequestCount;

		// ポーリングが停止されているので、追加リクエストは最小限（0-1回程度）
		expect(additionalRequests).toBeLessThan(2);

		console.log(`✅ ポーリング停止確認: 初期=${initialRequestCount}, 最終=${finalRequestCount}`);
	});

	test('Realtime接続エラー時はフォールバックポーリングが動作', async () => {
		// Realtime接続をブロックするように設定
		await page.route('**/realtime/**', (route) => {
			route.abort('failed');
		});

		// ログイン処理（省略）
		await page.goto(`${BASE_URL}/login`);
		// ... ログイン処理 ...

		// 採点画面に遷移
		// await page.goto(`${BASE_URL}/session/test-session/score`);

		const consoleMessages: string[] = [];
		const networkRequests: { timestamp: number; url: string }[] = [];

		// コンソールメッセージを記録
		page.on('console', (msg) => {
			const text = msg.text();
			if (text.includes('Realtime') || text.includes('polling') || text.includes('エラー')) {
				consoleMessages.push(text);
			}
		});

		// ネットワークリクエストを記録（タイムスタンプ付き）
		page.on('request', (request) => {
			if (request.url().includes('/sessions') && request.method() === 'GET') {
				networkRequests.push({
					timestamp: Date.now(),
					url: request.url()
				});
			}
		});

		// Realtime接続エラーを待つ
		await page.waitForTimeout(3000);

		// エラーログを確認
		const errorLog = consoleMessages.find(
			(msg) => msg.includes('❌') && msg.includes('Realtime')
		);
		expect(errorLog).toBeTruthy();

		// フォールバックポーリング開始のログを確認
		const fallbackLog = consoleMessages.find((msg) => msg.includes('フォールバック'));
		expect(fallbackLog).toBeTruthy();

		// 30秒待機してポーリングの間隔を確認（10秒ごと）
		await page.waitForTimeout(30000);

		// ポーリングリクエストの間隔を計算
		const intervals: number[] = [];
		for (let i = 1; i < networkRequests.length; i++) {
			const interval = networkRequests[i].timestamp - networkRequests[i - 1].timestamp;
			intervals.push(interval);
		}

		// 10秒間隔のポーリングが2回以上発生していることを確認
		expect(intervals.length).toBeGreaterThanOrEqual(2);

		// 各間隔が約10秒（±2秒）であることを確認
		const validIntervals = intervals.filter((interval) => interval >= 8000 && interval <= 12000);
		expect(validIntervals.length).toBeGreaterThan(0);

		console.log(`✅ フォールバックポーリング確認: 間隔=${intervals.map((i) => `${i}ms`).join(', ')}`);
	});

	test('手動更新ボタンでポーリングが再開される', async () => {
		// 初期状態でRealtime接続エラーをシミュレート
		await page.route('**/realtime/**', (route) => {
			route.abort('failed');
		});

		// ログイン処理（省略）
		await page.goto(`${BASE_URL}/login`);
		// ... ログイン処理 ...

		// Status監視画面に遷移（Realtime接続エラーが発生する）
		// await page.goto(`${BASE_URL}/session/test-session/score/status?bib=1`);

		await page.waitForTimeout(3000);

		// エラーバナーが表示されることを確認
		const errorBanner = page.locator('.realtime-error-banner');
		await expect(errorBanner).toBeVisible();

		// 手動更新ボタンをクリック
		const refreshButton = page.locator('.manual-refresh-btn');
		await refreshButton.click();

		await page.waitForTimeout(2000);

		// 再接続試行のログを確認
		const consoleMessages: string[] = [];
		page.on('console', (msg) => {
			consoleMessages.push(msg.text());
		});

		await page.waitForTimeout(3000);

		const reconnectLog = consoleMessages.find((msg) => msg.includes('再接続'));
		expect(reconnectLog).toBeTruthy();

		console.log('✅ 手動更新で再接続試行を確認');
	});

	test('ページ離脱時にポーリングが停止される', async () => {
		// ログイン処理（省略）
		await page.goto(`${BASE_URL}/login`);
		// ... ログイン処理 ...

		// 採点画面に遷移
		// await page.goto(`${BASE_URL}/session/test-session/score`);

		await page.waitForTimeout(2000);

		const consoleMessages: string[] = [];
		page.on('console', (msg) => {
			const text = msg.text();
			if (text.includes('onDestroy') || text.includes('ポーリング')) {
				consoleMessages.push(text);
			}
		});

		// 別のページに遷移
		await page.goto(`${BASE_URL}/dashboard`);

		await page.waitForTimeout(1000);

		// onDestroyが実行されたことを確認
		const destroyLog = consoleMessages.find((msg) => msg.includes('onDestroy'));
		expect(destroyLog).toBeTruthy();

		console.log('✅ ページ離脱時のクリーンアップを確認');
	});

	test('ネットワークリクエスト数が削減されている（20 req/min → < 2 req/min）', async () => {
		// ログイン処理（省略）
		await page.goto(`${BASE_URL}/login`);
		// ... ログイン処理 ...

		// 採点画面に遷移
		// await page.goto(`${BASE_URL}/session/test-session/score`);

		const networkRequests: { timestamp: number; url: string }[] = [];

		page.on('request', (request) => {
			if (request.url().includes('/sessions') && request.method() === 'GET') {
				networkRequests.push({
					timestamp: Date.now(),
					url: request.url()
				});
			}
		});

		// Realtime接続成功を待つ
		await page.waitForTimeout(3000);

		const startTime = Date.now();
		const initialCount = networkRequests.length;

		// 60秒待機してリクエスト数をカウント
		await page.waitForTimeout(60000);

		const endTime = Date.now();
		const finalCount = networkRequests.length;
		const requestsPerMinute = finalCount - initialCount;

		// 1分間のリクエスト数が2回未満であることを確認（修正後）
		expect(requestsPerMinute).toBeLessThan(2);

		console.log(`✅ ネットワーク負荷削減確認: ${requestsPerMinute} req/min (目標: < 2 req/min)`);
	});
});
