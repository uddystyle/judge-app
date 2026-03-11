/**
 * 複数検定員モードのRealtime機能 E2Eテスト
 *
 * Playwrightを使用して、複数のブラウザコンテキストで
 * 同時に検定員として操作し、リアルタイム更新を検証します。
 *
 * 実行方法:
 *   npm run test:e2e
 *   または
 *   npx playwright test tests/e2e/multi-judge-realtime.spec.ts
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

// テスト設定
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const TEST_TIMEOUT = 30000;

// テストユーザー情報（環境変数から取得）
const CHIEF_EMAIL = process.env.TEST_CHIEF_EMAIL || 'chief@example.com';
const CHIEF_PASSWORD = process.env.TEST_CHIEF_PASSWORD || 'password';
const JUDGE1_EMAIL = process.env.TEST_JUDGE1_EMAIL || 'judge1@example.com';
const JUDGE1_PASSWORD = process.env.TEST_JUDGE1_PASSWORD || 'password';
const JUDGE2_EMAIL = process.env.TEST_JUDGE2_EMAIL || 'judge2@example.com';
const JUDGE2_PASSWORD = process.env.TEST_JUDGE2_PASSWORD || 'password';

test.describe('Multi-Judge Realtime Score Monitoring', () => {
	test.setTimeout(TEST_TIMEOUT);

	// 複数のブラウザコンテキスト
	let chiefContext: BrowserContext;
	let judge1Context: BrowserContext;
	let judge2Context: BrowserContext;

	let chiefPage: Page;
	let judge1Page: Page;
	let judge2Page: Page;

	let sessionId: string;

	test.beforeAll(async ({ browser }) => {
		// 3つの独立したブラウザコンテキストを作成
		chiefContext = await browser.newContext();
		judge1Context = await browser.newContext();
		judge2Context = await browser.newContext();

		chiefPage = await chiefContext.newPage();
		judge1Page = await judge1Context.newPage();
		judge2Page = await judge2Context.newPage();

		// コンソールログをキャプチャ
		chiefPage.on('console', (msg) => console.log(`[Chief] ${msg.text()}`));
		judge1Page.on('console', (msg) => console.log(`[Judge1] ${msg.text()}`));
		judge2Page.on('console', (msg) => console.log(`[Judge2] ${msg.text()}`));
	});

	test.afterAll(async () => {
		await chiefContext.close();
		await judge1Context.close();
		await judge2Context.close();
	});

	test('複数検定員が同時にスコアを入力し、リアルタイムで反映される', async () => {
		// Step 1: 主任検定員がログインしてセッションを作成
		await chiefPage.goto(`${BASE_URL}/login`);
		await chiefPage.fill('input[type="email"]', CHIEF_EMAIL);
		await chiefPage.fill('input[type="password"]', CHIEF_PASSWORD);
		await chiefPage.click('button[type="submit"]');
		await chiefPage.waitForURL('**/dashboard', { timeout: 5000 });

		// セッション作成（実際のUIフローに合わせて調整）
		await chiefPage.click('text=新規セッション作成');
		// ... セッション作成フロー

		// セッションIDを取得
		sessionId = chiefPage.url().match(/session\/([^/]+)/)?.[1] || '';
		expect(sessionId).toBeTruthy();

		console.log(`✅ Session created: ${sessionId}`);

		// Step 2: 一般検定員2名がログイン
		await judge1Page.goto(`${BASE_URL}/login`);
		await judge1Page.fill('input[type="email"]', JUDGE1_EMAIL);
		await judge1Page.fill('input[type="password"]', JUDGE1_PASSWORD);
		await judge1Page.click('button[type="submit"]');
		await judge1Page.waitForURL('**/dashboard');

		await judge2Page.goto(`${BASE_URL}/login`);
		await judge2Page.fill('input[type="email"]', JUDGE2_EMAIL);
		await judge2Page.fill('input[type="password"]', JUDGE2_PASSWORD);
		await judge2Page.click('button[type="submit"]');
		await judge2Page.waitForURL('**/dashboard');

		// セッションに参加
		await judge1Page.goto(`${BASE_URL}/session/${sessionId}`);
		await judge2Page.goto(`${BASE_URL}/session/${sessionId}`);

		// Step 3: 主任検定員が採点指示を出す
		await chiefPage.click('text=採点指示');
		await chiefPage.fill('input[name="bib"]', '1');
		await chiefPage.click('button:has-text("開始")');

		// Step 4: 検定員1がスコアを入力
		await judge1Page.waitForSelector('input[name="score"]', { timeout: 5000 });
		await judge1Page.fill('input[name="score"]', '85');
		await judge1Page.click('button[type="submit"]');

		// Step 5: 主任検定員の画面でスコアが即座に表示されることを確認
		await chiefPage.waitForSelector('text=検定員1', { timeout: 1000 });
		await chiefPage.waitForSelector('text=85', { timeout: 1000 });

		// Realtimeログを確認
		const logs = await chiefPage.evaluate(() => {
			return (window as any).__realtimeLogs || [];
		});
		expect(logs.some((log: string) => log.includes('スコア変更を検知'))).toBe(true);

		// Step 6: 検定員2がスコアを入力
		await judge2Page.waitForSelector('input[name="score"]');
		await judge2Page.fill('input[name="score"]', '87');
		await judge2Page.click('button[type="submit"]');

		// Step 7: 主任検定員の画面で2人目のスコアも即座に表示される
		await chiefPage.waitForSelector('text=検定員2', { timeout: 1000 });
		await chiefPage.waitForSelector('text=87', { timeout: 1000 });

		// Step 8: スコア数を確認
		const scoreCount = await chiefPage.locator('.participant-item').count();
		expect(scoreCount).toBe(2);

		console.log('✅ Realtime score updates working correctly');
	});

	test('修正要求がリアルタイムで検知される', async () => {
		// 前提: セッションが作成され、検定員がスコアを入力済み

		// Step 1: 主任検定員がスコア確認画面を開く
		await chiefPage.goto(`${BASE_URL}/session/${sessionId}/score/status?bib=1`);

		// Step 2: 検定員1がスコアを入力
		await judge1Page.goto(`${BASE_URL}/session/${sessionId}/score/input?bib=1`);
		await judge1Page.fill('input[name="score"]', '80');
		await judge1Page.click('button[type="submit"]');

		// スコアが表示されるのを待つ
		await chiefPage.waitForSelector('text=80', { timeout: 2000 });

		// Step 3: 主任検定員が修正要求
		await chiefPage.click('button:has-text("修正")');

		// Step 4: 検定員1の画面が自動的に採点画面に遷移することを確認
		await judge1Page.waitForURL('**/score/input', { timeout: 2000 });

		// Realtimeログを確認
		const logs = await judge1Page.evaluate(() => {
			return (window as any).__realtimeLogs || [];
		});
		expect(logs.some((log: string) => log.includes('DELETE'))).toBe(true);

		console.log('✅ Score correction request detected in real-time');
	});

	test('セッション終了がリアルタイムで検知される', async () => {
		// Step 1: 検定員が待機画面にいる
		await judge1Page.goto(`${BASE_URL}/session/${sessionId}`);
		await judge2Page.goto(`${BASE_URL}/session/${sessionId}`);

		// Step 2: 主任検定員がセッションを終了
		await chiefPage.goto(`${BASE_URL}/session/${sessionId}`);
		await chiefPage.click('button:has-text("検定を終了")');

		// Step 3: 検定員の画面が即座に終了画面に遷移
		await judge1Page.waitForURL('**/session/**?ended=true', { timeout: 2000 });
		await judge2Page.waitForURL('**/session/**?ended=true', { timeout: 2000 });

		// 終了メッセージを確認
		await expect(judge1Page.locator('text=検定が終了しました')).toBeVisible();
		await expect(judge2Page.locator('text=検定が終了しました')).toBeVisible();

		console.log('✅ Session end detected in real-time');
	});

	test('スコアボードがリアルタイムで更新される', async () => {
		// Step 1: スコアボードを開く
		const scoreboardPage = await chiefContext.newPage();
		await scoreboardPage.goto(`${BASE_URL}/scoreboard/${sessionId}`);

		// Realtimeログを確認
		const logs: string[] = [];
		scoreboardPage.on('console', (msg) => {
			const text = msg.text();
			logs.push(text);
			console.log(`[Scoreboard] ${text}`);
		});

		// 接続成功ログを待つ
		await scoreboardPage.waitForTimeout(1000);
		expect(logs.some((log) => log.includes('Realtime接続成功'))).toBe(true);

		// Step 2: 主任検定員が新しいスコアを確定
		await chiefPage.goto(`${BASE_URL}/session/${sessionId}`);
		await chiefPage.click('text=採点指示');
		await chiefPage.fill('input[name="bib"]', '2');
		await chiefPage.click('button:has-text("開始")');

		// 検定員がスコアを入力
		await judge1Page.goto(`${BASE_URL}/session/${sessionId}/score/input?bib=2`);
		await judge1Page.fill('input[name="score"]', '90');
		await judge1Page.click('button[type="submit"]');

		// 主任検定員が確定
		await chiefPage.click('button:has-text("確定")');

		// Step 3: スコアボードが即座に更新される
		// 注: 現在の実装ではページリロードが発生するが、将来的には差分更新に置き換え
		await scoreboardPage.waitForTimeout(2000);

		// スコアが表示されることを確認
		await expect(scoreboardPage.locator('text=90')).toBeVisible();

		console.log('✅ Scoreboard updated in real-time');

		await scoreboardPage.close();
	});

	test('100人の検定員でもパフォーマンスが維持される', async () => {
		// このテストは実際には実行しないが、パフォーマンステストの例として記載

		test.skip();

		// 100個のブラウザコンテキストを作成（実環境では重いのでスキップ推奨）
		const judgeContexts: BrowserContext[] = [];
		const judgePages: Page[] = [];

		for (let i = 0; i < 100; i++) {
			const context = await chiefContext.browser()!.newContext();
			const page = await context.newPage();
			judgeContexts.push(context);
			judgePages.push(page);
		}

		// 全員が同時にスコアを入力
		const startTime = Date.now();
		await Promise.all(
			judgePages.map(async (page, i) => {
				await page.goto(`${BASE_URL}/session/${sessionId}/score/input?bib=1`);
				await page.fill('input[name="score"]', String(80 + i));
				await page.click('button[type="submit"]');
			})
		);
		const duration = Date.now() - startTime;

		console.log(`✅ 100 judges submitted scores in ${duration}ms`);
		expect(duration).toBeLessThan(10000); // 10秒以内

		// クリーンアップ
		for (const context of judgeContexts) {
			await context.close();
		}
	});
});

/**
 * Realtimeログをキャプチャするためのヘルパー
 * アプリケーション側で以下のコードを追加する必要があります：
 *
 * // src/routes/+layout.svelte または各ページ
 * if (typeof window !== 'undefined') {
 *   (window as any).__realtimeLogs = [];
 *   const originalLog = console.log;
 *   console.log = function(...args) {
 *     if (args[0]?.includes('[status/realtime]') || args[0]?.includes('[scoreboard]')) {
 *       (window as any).__realtimeLogs.push(args[0]);
 *     }
 *     originalLog.apply(console, args);
 *   };
 * }
 */
