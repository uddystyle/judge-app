import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * logger はモジュール読み込み時に NODE_ENV を評価するため、
 * 環境ごとに vi.resetModules() + 動的 import で読み直す
 */
async function importLogger(nodeEnv: string) {
	vi.resetModules();
	vi.stubEnv('NODE_ENV', nodeEnv);
	const { logger } = await import('./logger');
	return logger;
}

describe('logger', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('開発環境では全レベルを出力する', async () => {
		const logger = await importLogger('development');

		logger.debug('debug message');
		logger.info('info message');
		logger.warn('warn message');
		logger.error('error message');

		expect(console.log).toHaveBeenCalledTimes(1);
		expect(console.info).toHaveBeenCalledTimes(1);
		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(console.error).toHaveBeenCalledTimes(1);
	});

	it('本番環境では debug / info を抑制し warn / error のみ出力する', async () => {
		const logger = await importLogger('production');

		logger.debug('debug message');
		logger.info('info message');
		logger.warn('warn message');
		logger.error('error message');

		expect(console.log).not.toHaveBeenCalled();
		expect(console.info).not.toHaveBeenCalled();
		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(console.error).toHaveBeenCalledTimes(1);
	});

	it('本番環境ではオブジェクトの機密キーを再帰的に [REDACTED] する', async () => {
		const logger = await importLogger('production');

		logger.error('context', {
			user_id: 'u-1',
			email: 'a@example.com',
			nested: { stripe_customer_id: 'cus_123', safe: 'ok' },
			plan: 'basic'
		});

		const args = vi.mocked(console.error).mock.calls[0];
		expect(args[1]).toBe('context');
		expect(args[2]).toEqual({
			user_id: '[REDACTED]',
			email: '[REDACTED]',
			nested: { stripe_customer_id: '[REDACTED]', safe: 'ok' },
			plan: 'basic'
		});
	});

	it('開発環境ではレダクションしない（デバッグ性維持）', async () => {
		const logger = await importLogger('development');

		logger.error('context', { user_id: 'u-1' });

		const args = vi.mocked(console.error).mock.calls[0];
		expect(args[2]).toEqual({ user_id: 'u-1' });
	});
});
