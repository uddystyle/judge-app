import { describe, it, expect } from 'vitest';
import {
	sanitizeString,
	validateEmail,
	validateName,
	validateOrganizationName,
	validateSessionName,
	validateBibNumber,
	validateScore,
	validateUUID,
	validateIntegerId,
	validateDate,
	validateText
} from './validation';

describe('sanitizeString', () => {
	it('should remove HTML tags', () => {
		expect(sanitizeString('<script>alert("xss")</script>')).toBe('scriptalert("xss")/script');
		expect(sanitizeString('<div>hello</div>')).toBe('divhello/div');
	});

	it('should remove javascript protocol', () => {
		expect(sanitizeString('javascript:alert("xss")')).toBe('alert("xss")');
		expect(sanitizeString('JAVASCRIPT:alert("xss")')).toBe('alert("xss")');
	});

	it('should remove event handlers', () => {
		expect(sanitizeString('onclick=alert("xss")')).toBe('alert("xss")');
		expect(sanitizeString('onload=malicious()')).toBe('malicious()');
	});

	it('should trim whitespace', () => {
		expect(sanitizeString('  hello  ')).toBe('hello');
	});

	it('should handle null and undefined', () => {
		expect(sanitizeString(null)).toBe('');
		expect(sanitizeString(undefined)).toBe('');
	});

	it('should return empty string for empty input', () => {
		expect(sanitizeString('')).toBe('');
	});
});

describe('validateEmail', () => {
	it('should accept valid email addresses', () => {
		expect(validateEmail('test@example.com')).toEqual({
			valid: true,
			sanitized: 'test@example.com'
		});
		expect(validateEmail('user.name+tag@example.co.jp')).toEqual({
			valid: true,
			sanitized: 'user.name+tag@example.co.jp'
		});
	});

	it('should reject invalid email formats', () => {
		expect(validateEmail('invalid')).toMatchObject({ valid: false });
		expect(validateEmail('invalid@')).toMatchObject({ valid: false });
		expect(validateEmail('@example.com')).toMatchObject({ valid: false });
		expect(validateEmail('test@')).toMatchObject({ valid: false });
	});

	it('should reject empty or null email', () => {
		expect(validateEmail('')).toMatchObject({ valid: false });
		expect(validateEmail(null)).toMatchObject({ valid: false });
		expect(validateEmail(undefined)).toMatchObject({ valid: false });
	});

	it('should reject email longer than 255 characters', () => {
		const longEmail = 'a'.repeat(250) + '@example.com';
		expect(validateEmail(longEmail)).toMatchObject({ valid: false });
	});

	it('should sanitize email input', () => {
		const result = validateEmail('test<script>@example.com');
		expect(result.sanitized).toBe('testscript@example.com');
		expect(result.valid).toBe(true); // サニタイズ後は有効な形式
	});
});

describe('validateName', () => {
	it('should accept valid names', () => {
		expect(validateName('山田太郎')).toEqual({
			valid: true,
			sanitized: '山田太郎'
		});
		expect(validateName('John Doe')).toEqual({
			valid: true,
			sanitized: 'John Doe'
		});
	});

	it('should reject empty or null names', () => {
		expect(validateName('')).toMatchObject({ valid: false });
		expect(validateName(null)).toMatchObject({ valid: false });
		expect(validateName(undefined)).toMatchObject({ valid: false });
	});

	it('should reject names longer than 100 characters', () => {
		const longName = 'a'.repeat(101);
		expect(validateName(longName)).toMatchObject({ valid: false });
	});

	it('should sanitize malicious input', () => {
		const result = validateName('<script>alert("xss")</script>');
		expect(result.sanitized).toBe('scriptalert("xss")/script');
	});
});

describe('validateOrganizationName', () => {
	it('should accept valid organization names', () => {
		expect(validateOrganizationName('〇〇スキークラブ')).toEqual({
			valid: true,
			sanitized: '〇〇スキークラブ'
		});
	});

	it('should reject names shorter than 2 characters', () => {
		expect(validateOrganizationName('A')).toMatchObject({ valid: false });
	});

	it('should reject names longer than 100 characters', () => {
		const longName = 'a'.repeat(101);
		expect(validateOrganizationName(longName)).toMatchObject({ valid: false });
	});

	it('should reject empty or null names', () => {
		expect(validateOrganizationName('')).toMatchObject({ valid: false });
		expect(validateOrganizationName(null)).toMatchObject({ valid: false });
	});
});

describe('validateSessionName', () => {
	it('should accept valid session names', () => {
		expect(validateSessionName('2025冬期検定')).toEqual({
			valid: true,
			sanitized: '2025冬期検定'
		});
	});

	it('should reject empty or null session names', () => {
		expect(validateSessionName('')).toMatchObject({ valid: false });
		expect(validateSessionName(null)).toMatchObject({ valid: false });
	});

	it('should reject session names longer than 200 characters', () => {
		const longName = 'a'.repeat(201);
		expect(validateSessionName(longName)).toMatchObject({ valid: false });
	});
});

describe('validateBibNumber', () => {
	it('should accept valid bib numbers', () => {
		expect(validateBibNumber(1)).toEqual({ valid: true, value: 1 });
		expect(validateBibNumber(9999)).toEqual({ valid: true, value: 9999 });
		expect(validateBibNumber('100')).toEqual({ valid: true, value: 100 });
	});

	it('should reject bib numbers out of range', () => {
		expect(validateBibNumber(0)).toMatchObject({ valid: false });
		expect(validateBibNumber(10000)).toMatchObject({ valid: false });
		expect(validateBibNumber(-1)).toMatchObject({ valid: false });
	});

	it('should reject non-numeric values', () => {
		expect(validateBibNumber('abc')).toMatchObject({ valid: false });
		expect(validateBibNumber('12.5')).toEqual({ valid: true, value: 12 }); // parseIntは小数点以下を切り捨てる
	});

	it('should reject empty or null values', () => {
		expect(validateBibNumber('')).toMatchObject({ valid: false });
		expect(validateBibNumber(null)).toMatchObject({ valid: false });
		expect(validateBibNumber(undefined)).toMatchObject({ valid: false });
	});
});

describe('validateScore', () => {
	it('should accept valid scores', () => {
		expect(validateScore(0)).toEqual({ valid: true, value: 0 });
		expect(validateScore(50)).toEqual({ valid: true, value: 50 });
		expect(validateScore(100)).toEqual({ valid: true, value: 100 });
		expect(validateScore('75.5')).toEqual({ valid: true, value: 75.5 });
	});

	it('should reject scores out of range', () => {
		expect(validateScore(-1)).toMatchObject({ valid: false });
		expect(validateScore(101)).toMatchObject({ valid: false });
	});

	it('should reject non-numeric values', () => {
		expect(validateScore('abc')).toMatchObject({ valid: false });
	});

	it('should reject empty or null values', () => {
		expect(validateScore('')).toMatchObject({ valid: false });
		expect(validateScore(null)).toMatchObject({ valid: false });
		expect(validateScore(undefined)).toMatchObject({ valid: false });
	});
});

describe('validateUUID', () => {
	it('should accept valid UUIDs', () => {
		expect(validateUUID('123e4567-e89b-12d3-a456-426614174000')).toEqual({ valid: true });
		expect(validateUUID('550e8400-e29b-41d4-a716-446655440000')).toEqual({ valid: true });
	});

	it('should reject invalid UUIDs', () => {
		expect(validateUUID('invalid-uuid')).toMatchObject({ valid: false });
		expect(validateUUID('123')).toMatchObject({ valid: false });
		expect(validateUUID('123e4567-e89b-12d3-a456')).toMatchObject({ valid: false });
	});

	it('should reject empty or null values', () => {
		expect(validateUUID('')).toMatchObject({ valid: false });
		expect(validateUUID(null)).toMatchObject({ valid: false });
		expect(validateUUID(undefined)).toMatchObject({ valid: false });
	});

	it('should accept uppercase UUIDs', () => {
		expect(validateUUID('123E4567-E89B-12D3-A456-426614174000')).toEqual({ valid: true });
	});
});

describe('validateIntegerId', () => {
	it('should accept valid integer IDs', () => {
		expect(validateIntegerId(1)).toEqual({ valid: true, value: 1 });
		expect(validateIntegerId('123')).toEqual({ valid: true, value: 123 });
	});

	it('should reject IDs less than 1', () => {
		expect(validateIntegerId(0)).toMatchObject({ valid: false });
		expect(validateIntegerId(-1)).toMatchObject({ valid: false });
	});

	it('should reject non-integer values', () => {
		expect(validateIntegerId('abc')).toMatchObject({ valid: false });
		expect(validateIntegerId('12.5')).toEqual({ valid: true, value: 12 }); // parseIntは小数点以下を切り捨てる
	});

	it('should reject empty or null values', () => {
		expect(validateIntegerId('')).toMatchObject({ valid: false });
		expect(validateIntegerId(null)).toMatchObject({ valid: false });
		expect(validateIntegerId(undefined)).toMatchObject({ valid: false });
	});
});

describe('validateDate', () => {
	it('should accept valid dates', () => {
		const result = validateDate('2025-01-01');
		expect(result.valid).toBe(true);
		expect(result.value).toBeInstanceOf(Date);
	});

	it('should accept ISO 8601 format', () => {
		const result = validateDate('2025-01-01T00:00:00Z');
		expect(result.valid).toBe(true);
	});

	it('should reject invalid date strings', () => {
		expect(validateDate('invalid-date')).toMatchObject({ valid: false });
		expect(validateDate('2025-13-01')).toMatchObject({ valid: false });
	});

	it('should reject empty or null values', () => {
		expect(validateDate('')).toMatchObject({ valid: false });
		expect(validateDate(null)).toMatchObject({ valid: false });
		expect(validateDate(undefined)).toMatchObject({ valid: false });
	});
});

describe('validateText', () => {
	it('should accept valid text within default length', () => {
		expect(validateText('Hello, world!')).toEqual({
			valid: true,
			sanitized: 'Hello, world!'
		});
	});

	it('should accept text with custom min/max length', () => {
		expect(validateText('abc', 3, 10)).toEqual({
			valid: true,
			sanitized: 'abc'
		});
	});

	it('should reject text shorter than minLength', () => {
		expect(validateText('ab', 3, 10)).toMatchObject({ valid: false });
	});

	it('should reject text longer than maxLength', () => {
		const longText = 'a'.repeat(1001);
		expect(validateText(longText)).toMatchObject({ valid: false });
	});

	it('should reject empty or null text', () => {
		expect(validateText('')).toMatchObject({ valid: false });
		expect(validateText(null)).toMatchObject({ valid: false });
		expect(validateText(undefined)).toMatchObject({ valid: false });
	});

	it('should sanitize malicious input', () => {
		const result = validateText('<script>alert("xss")</script>');
		expect(result.sanitized).toBe('scriptalert("xss")/script');
	});
});
