import { describe, it, expect } from 'vitest';
import {
	validateEmail,
	validateName,
	validatePassword,
	validateOrganizationName,
	validateSessionName,
	validateBibNumber,
	validateScore,
	validateBib,
	validateScoreInput,
	validateScoreRange,
	validateUUID,
	validateIntegerId,
	validateDate,
	validateText
} from '$lib/server/validation';

/**
 * validation.tsのi18n対応テスト
 * Paraglideのデフォルトlocale(ja)でメッセージが正しく返されることを確認
 */
describe('validation.ts - i18nメッセージが返される', () => {
	describe('validateEmail', () => {
		it('空入力でエラーメッセージが返される', () => {
			const result = validateEmail('');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
			expect(typeof result.error).toBe('string');
			expect(result.error!.length).toBeGreaterThan(0);
		});

		it('不正な形式でエラーメッセージが返される', () => {
			const result = validateEmail('invalid');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});
	});

	describe('validateName', () => {
		it('空入力でエラーメッセージが返される', () => {
			const result = validateName('');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});

		it('長すぎる名前でパラメータ付きエラーメッセージが返される', () => {
			const result = validateName('a'.repeat(101));
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
			// パラメータ{max}が展開されていることを確認（生の{max}が残っていないこと）
			expect(result.error).not.toContain('{max}');
		});
	});

	describe('validatePassword', () => {
		it('空入力でエラーメッセージが返される', () => {
			const result = validatePassword('');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});

		it('短すぎるパスワードでパラメータ付きエラーメッセージが返される', () => {
			const result = validatePassword('abc');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
			expect(result.error).not.toContain('{min}');
		});

		it('長すぎるパスワードでパラメータ付きエラーメッセージが返される', () => {
			const result = validatePassword('a'.repeat(73));
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
			expect(result.error).not.toContain('{max}');
		});
	});

	describe('validateOrganizationName', () => {
		it('空入力でエラーメッセージが返される', () => {
			const result = validateOrganizationName('');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});

		it('短すぎる名前でパラメータ付きエラーメッセージが返される', () => {
			const result = validateOrganizationName('A');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
			expect(result.error).not.toContain('{min}');
		});
	});

	describe('validateSessionName', () => {
		it('空入力でエラーメッセージが返される', () => {
			const result = validateSessionName('');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});
	});

	describe('validateBibNumber', () => {
		it('空入力でエラーメッセージが返される', () => {
			const result = validateBibNumber('');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});

		it('範囲外でパラメータ付きエラーメッセージが返される', () => {
			const result = validateBibNumber(10000);
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
			expect(result.error).not.toContain('{min}');
			expect(result.error).not.toContain('{max}');
		});
	});

	describe('validateScore', () => {
		it('空入力でエラーメッセージが返される', () => {
			const result = validateScore('');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});

		it('範囲外でパラメータ付きエラーメッセージが返される', () => {
			const result = validateScore(101);
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
			expect(result.error).not.toContain('{min}');
			expect(result.error).not.toContain('{max}');
		});
	});

	describe('validateBib (採点フォーム用)', () => {
		it('不正入力でエラーメッセージが返される', () => {
			const result = validateBib('abc');
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeTruthy();
			}
		});
	});

	describe('validateScoreInput (採点フォーム用)', () => {
		it('不正入力でエラーメッセージが返される', () => {
			const result = validateScoreInput('abc');
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeTruthy();
			}
		});

		it('小数でエラーメッセージが返される', () => {
			const result = validateScoreInput('8.5');
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeTruthy();
			}
		});
	});

	describe('validateScoreRange (採点フォーム用)', () => {
		it('範囲外でパラメータ付きエラーメッセージが返される', () => {
			const result = validateScoreRange(101, 0, 100);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeTruthy();
				expect(result.error).not.toContain('{min}');
				expect(result.error).not.toContain('{max}');
			}
		});
	});

	describe('validateUUID', () => {
		it('空入力でエラーメッセージが返される', () => {
			const result = validateUUID('');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});

		it('不正なUUIDでエラーメッセージが返される', () => {
			const result = validateUUID('not-a-uuid');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});
	});

	describe('validateIntegerId', () => {
		it('空入力でエラーメッセージが返される', () => {
			const result = validateIntegerId('');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});
	});

	describe('validateDate', () => {
		it('空入力でエラーメッセージが返される', () => {
			const result = validateDate('');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});

		it('不正な日付でエラーメッセージが返される', () => {
			const result = validateDate('not-a-date');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});
	});

	describe('validateText', () => {
		it('空入力でエラーメッセージが返される', () => {
			const result = validateText('');
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
		});

		it('短すぎるテキストでパラメータ付きエラーメッセージが返される', () => {
			const result = validateText('a', 5);
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
			expect(result.error).not.toContain('{min}');
		});

		it('長すぎるテキストでパラメータ付きエラーメッセージが返される', () => {
			const result = validateText('a'.repeat(11), 1, 10);
			expect(result.valid).toBe(false);
			expect(result.error).toBeTruthy();
			expect(result.error).not.toContain('{max}');
		});
	});
});
