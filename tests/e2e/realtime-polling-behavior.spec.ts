/**
 * Realtime / polling の実環境 E2E。
 *
 * 事前に、一般検定員が参加済みで active_prompt_id が null のテスト用セッションを用意する。
 * 必須環境変数は tests/e2e/SETUP.md を参照。
 */

import { test, expect, type Page, type Request } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_JUDGE_EMAIL ?? process.env.TEST_JUDGE1_EMAIL;
const TEST_PASSWORD = process.env.TEST_JUDGE_PASSWORD ?? process.env.TEST_JUDGE1_PASSWORD;
const TEST_SESSION_ID = process.env.TEST_REALTIME_SESSION_ID;
const TEST_TIMEOUT = 65_000;

const missingConfiguration = !TEST_EMAIL || !TEST_PASSWORD || !TEST_SESSION_ID;
const targetPath = `/session/${TEST_SESSION_ID ?? 'missing-session-id'}`;
const channelName = `session-status-${TEST_SESSION_ID ?? 'missing-session-id'}`;

function isSessionPollingRequest(request: Request): boolean {
	const url = new URL(request.url());
	return (
		request.method() === 'GET' &&
		url.pathname.endsWith('/rest/v1/sessions') &&
		url.searchParams.get('id') === `eq.${TEST_SESSION_ID}`
	);
}

async function loginToSession(page: Page): Promise<void> {
	await page.goto(`/login?next=${encodeURIComponent(targetPath)}`);
	await page.locator('input[name="email"]').fill(TEST_EMAIL!);
	await page.locator('input[name="password"]').fill(TEST_PASSWORD!);

	await Promise.all([
		page.waitForURL((url) => url.pathname === targetPath, { timeout: 10_000 }),
		page.getByRole('button', { name: /ログイン|log in|login/i }).click()
	]);

	// active prompt が残った不適切な fixture では採点画面へ自動遷移するため、早期に失敗させる。
	await expect(page).toHaveURL((url) => url.pathname === targetPath);
}

test.describe('Realtime polling behavior', () => {
	test.setTimeout(TEST_TIMEOUT);
	test.skip(
		missingConfiguration,
		'TEST_JUDGE_EMAIL/PASSWORD（または TEST_JUDGE1_*）と TEST_REALTIME_SESSION_ID が必要です'
	);

	test('SUBSCRIBED後も30秒ヘルスポーリングを継続し、ページをreloadしない', async ({ page }) => {
		const consoleMessages: string[] = [];
		const sessionReads: number[] = [];
		let targetNavigations = 0;

		page.on('console', (message) => consoleMessages.push(message.text()));
		page.on('request', (request) => {
			if (isSessionPollingRequest(request)) sessionReads.push(Date.now());
		});
		page.on('framenavigated', (frame) => {
			if (frame === page.mainFrame() && new URL(frame.url()).pathname === targetPath) {
				targetNavigations++;
			}
		});

		await loginToSession(page);

		await expect
			.poll(
				() =>
					consoleMessages.some((message) =>
						message.includes(`[realtime/${channelName}] connected`)
					),
				{
					timeout: 10_000,
					message: 'Supabase Realtime が SUBSCRIBED にならなかった'
				}
			)
			.toBe(true);
		await expect
			.poll(() =>
				consoleMessages.some((message) =>
					message.includes(`[realtime/${channelName}] health polling started (30000ms)`)
				)
			)
			.toBe(true);

		// onSubscribed 内の即時状態同期を測定対象から除外する。
		await page.waitForTimeout(500);
		sessionReads.length = 0;
		targetNavigations = 0;

		await page.waitForTimeout(31_500);

		// 無変更・無配信でも health polling が1回動く。短周期pollingへの退行も同時に検知する。
		expect(sessionReads.length).toBeGreaterThanOrEqual(1);
		expect(sessionReads.length).toBeLessThanOrEqual(2);
		expect(targetNavigations).toBe(0);
		await expect(page).toHaveURL((url) => url.pathname === targetPath);
	});

	test('Realtimeが無応答でも3秒ポーリングにフォールバックし、離脱時に停止する', async ({
		page
	}) => {
		const consoleMessages: string[] = [];
		const sessionReads: number[] = [];

		// Supabase WebSocketだけを遮断し、PostgRESTのpollingは到達可能な状態にする。
		await page.routeWebSocket(/\/realtime\/v1\/websocket/, async (webSocket) => {
			await webSocket.close({ code: 1011, reason: 'E2E simulated realtime outage' });
		});
		page.on('console', (message) => consoleMessages.push(message.text()));
		page.on('request', (request) => {
			if (isSessionPollingRequest(request)) sessionReads.push(Date.now());
		});

		await loginToSession(page);

		await expect
			.poll(() =>
				consoleMessages.some((message) =>
					message.includes(`[realtime/${channelName}] fallback polling started (3000ms)`)
				)
			)
			.toBe(true);
		await expect
			.poll(() => sessionReads.length, {
				timeout: 8_000,
				message: 'Realtime無応答時に3秒pollingが継続しなかった'
			})
			.toBeGreaterThanOrEqual(2);

		await page.goto('/dashboard');
		sessionReads.length = 0;
		await page.waitForTimeout(4_000);

		// 待機画面のmonitorが破棄され、対象セッションへの短周期pollingが残らない。
		expect(sessionReads).toHaveLength(0);
	});
});
