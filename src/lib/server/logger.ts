const isProduction = process.env.NODE_ENV === 'production';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * サーバーサイド共通ロガー
 *
 * - 本番環境では warn / error のみ出力する（debug / info は抑制）
 * - 本番環境ではオブジェクト引数の機密キー（user_id, email, token など）を
 *   再帰的に [REDACTED] へ置換してから出力する
 *
 * サーバーサイドのコードでは console.* ではなく必ずこのロガーを使うこと。
 * console.log → logger.debug / console.info → logger.info /
 * console.warn → logger.warn / console.error → logger.error が対応。
 */

// 機密フィールドパターン
const SENSITIVE_PATTERNS = [
	/user_id/i,
	/subscription_id/i,
	/stripe_customer_id/i,
	/organization_id/i,
	/email/i,
	/password/i,
	/token/i,
	/secret/i,
	/api_key/i,
	/auth/i,
	/session/i
];

// 機密データの編集（本番のみ）
function redactSensitive(data: unknown): unknown {
	if (isProduction && typeof data === 'object' && data !== null) {
		const redacted: Record<string, unknown> = Array.isArray(data)
			? { ...([...data] as unknown as Record<string, unknown>) }
			: { ...(data as Record<string, unknown>) };

		for (const key in redacted) {
			const isSensitive = SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));

			if (isSensitive) {
				redacted[key] = '[REDACTED]';
			} else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
				redacted[key] = redactSensitive(redacted[key]);
			}
		}

		return Array.isArray(data) ? Object.values(redacted) : redacted;
	}

	return data;
}

class Logger {
	private log(level: LogLevel, ...args: unknown[]) {
		// 本番環境では警告とエラーのみログ出力
		if (isProduction && (level === 'debug' || level === 'info')) {
			return;
		}

		const timestamp = new Date().toISOString();
		const redactedArgs = args.map((arg) => redactSensitive(arg));

		switch (level) {
			case 'error':
				console.error(`[${timestamp}] ERROR:`, ...redactedArgs);
				break;
			case 'warn':
				console.warn(`[${timestamp}] WARN:`, ...redactedArgs);
				break;
			case 'info':
				console.info(`[${timestamp}] INFO:`, ...redactedArgs);
				break;
			case 'debug':
				console.log(`[${timestamp}] DEBUG:`, ...redactedArgs);
				break;
		}
	}

	debug(...args: unknown[]) {
		this.log('debug', ...args);
	}

	info(...args: unknown[]) {
		this.log('info', ...args);
	}

	warn(...args: unknown[]) {
		this.log('warn', ...args);
	}

	error(...args: unknown[]) {
		this.log('error', ...args);
	}
}

export const logger = new Logger();
