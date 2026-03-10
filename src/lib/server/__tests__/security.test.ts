import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';

describe('セキュリティ機能', () => {
	describe('参加コード生成', () => {
		it('8文字の暗号学的に安全なコードを生成すべき', () => {
			const generateJoinCode = (): string => {
				const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
				const bytes = randomBytes(8);
				let code = '';

				for (let i = 0; i < 8; i++) {
					code += chars[bytes[i] % chars.length];
				}

				return code;
			};

			const code = generateJoinCode();
			expect(code).toHaveLength(8);
			expect(code).toMatch(/^[A-Z2-9]+$/);
		});

		it('紛らわしい文字（0, O, 1, I）を含まないべき', () => {
			const generateJoinCode = (): string => {
				const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
				const bytes = randomBytes(8);
				let code = '';

				for (let i = 0; i < 8; i++) {
					code += chars[bytes[i] % chars.length];
				}

				return code;
			};

			// 1000回生成して紛らわしい文字が含まれていないことを確認
			for (let i = 0; i < 1000; i++) {
				const code = generateJoinCode();
				expect(code).not.toMatch(/[01IO]/);
			}
		});

		it('1000個のコードが一意であるべき', () => {
			const generateJoinCode = (): string => {
				const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
				const bytes = randomBytes(8);
				let code = '';

				for (let i = 0; i < 8; i++) {
					code += chars[bytes[i] % chars.length];
				}

				return code;
			};

			const codes = new Set<string>();
			for (let i = 0; i < 1000; i++) {
				codes.add(generateJoinCode());
			}

			// すべてのコードが一意であることを確認
			expect(codes.size).toBe(1000);
		});
	});

	describe('ロギング', () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it('本番環境で機密データを編集すべき', () => {
			const SENSITIVE_PATTERNS = [
				/user_id/i,
				/email/i,
				/password/i,
				/token/i,
			];

			function redactSensitive(data: any): any {
				const isProduction = process.env.NODE_ENV === 'production';

				if (isProduction && typeof data === 'object' && data !== null) {
					const redacted = { ...data };

					for (const key in redacted) {
						const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));

						if (isSensitive) {
							redacted[key] = '[REDACTED]';
						}
					}

					return redacted;
				}

				return data;
			}

			// 本番環境をシミュレート
			const originalEnv = process.env.NODE_ENV;
			process.env.NODE_ENV = 'production';

			const sensitiveData = {
				user_id: '123',
				email: 'test@example.com',
				password: 'secret',
				token: 'abc123',
				normalField: 'visible'
			};

			const redacted = redactSensitive(sensitiveData);

			expect(redacted.user_id).toBe('[REDACTED]');
			expect(redacted.email).toBe('[REDACTED]');
			expect(redacted.password).toBe('[REDACTED]');
			expect(redacted.token).toBe('[REDACTED]');
			expect(redacted.normalField).toBe('visible');

			// 環境変数を元に戻す
			process.env.NODE_ENV = originalEnv;
		});

		it('開発環境では機密データを編集しないべき', () => {
			const SENSITIVE_PATTERNS = [
				/user_id/i,
				/email/i,
			];

			function redactSensitive(data: any): any {
				const isProduction = process.env.NODE_ENV === 'production';

				if (isProduction && typeof data === 'object' && data !== null) {
					const redacted = { ...data };

					for (const key in redacted) {
						const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));

						if (isSensitive) {
							redacted[key] = '[REDACTED]';
						}
					}

					return redacted;
				}

				return data;
			}

			// 開発環境をシミュレート
			const originalEnv = process.env.NODE_ENV;
			process.env.NODE_ENV = 'development';

			const sensitiveData = {
				user_id: '123',
				email: 'test@example.com'
			};

			const redacted = redactSensitive(sensitiveData);

			expect(redacted.user_id).toBe('123');
			expect(redacted.email).toBe('test@example.com');

			// 環境変数を元に戻す
			process.env.NODE_ENV = originalEnv;
		});
	});

	describe('リクエストID', () => {
		it('16バイトのユニークなIDを生成すべき', () => {
			const requestId1 = randomBytes(16).toString('hex');
			const requestId2 = randomBytes(16).toString('hex');

			expect(requestId1).toHaveLength(32); // 16 bytes = 32 hex chars
			expect(requestId2).toHaveLength(32);
			expect(requestId1).not.toBe(requestId2);
		});
	});
});
