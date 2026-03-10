const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
	/session/i,
];

// 機密データの編集
function redactSensitive(data: any): any {
	if (isProduction && typeof data === 'object' && data !== null) {
		const redacted = Array.isArray(data) ? [...data] : { ...data };

		for (const key in redacted) {
			const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));

			if (isSensitive) {
				redacted[key] = '[REDACTED]';
			} else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
				redacted[key] = redactSensitive(redacted[key]);
			}
		}

		return redacted;
	}

	return data;
}

class Logger {
	private log(level: LogLevel, prefix: string, ...args: any[]) {
		// 本番環境では警告とエラーのみログ出力
		if (isProduction && (level === 'debug' || level === 'info')) {
			return;
		}

		const timestamp = new Date().toISOString();
		const redactedArgs = args.map(arg => redactSensitive(arg));

		switch (level) {
			case 'error':
				console.error(`[${timestamp}] [${prefix}] ERROR:`, ...redactedArgs);
				break;
			case 'warn':
				console.warn(`[${timestamp}] [${prefix}] WARN:`, ...redactedArgs);
				break;
			case 'info':
				console.info(`[${timestamp}] [${prefix}] INFO:`, ...redactedArgs);
				break;
			case 'debug':
				console.log(`[${timestamp}] [${prefix}] DEBUG:`, ...redactedArgs);
				break;
		}
	}

	debug(prefix: string, ...args: any[]) {
		this.log('debug', prefix, ...args);
	}

	info(prefix: string, ...args: any[]) {
		this.log('info', prefix, ...args);
	}

	warn(prefix: string, ...args: any[]) {
		this.log('warn', prefix, ...args);
	}

	error(prefix: string, ...args: any[]) {
		this.log('error', prefix, ...args);
	}
}

export const logger = new Logger();
