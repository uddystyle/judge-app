/**
 * サーバーサイドバリデーションユーティリティ
 * XSS、SQLインジェクション、その他の攻撃からの保護
 */

import { PUBLIC_SITE_URL } from '$env/static/public';
import * as m from '$lib/paraglide/messages.js';

/**
 * 文字列をサニタイズ（XSS対策）
 * HTMLタグを除去し、安全な文字列を返す
 */
export function sanitizeString(input: string | null | undefined): string {
	if (!input) return '';

	return String(input)
		.replace(/[<>]/g, '') // HTMLタグの開始・終了文字を除去
		.replace(/javascript:/gi, '') // javascriptプロトコルを除去
		.replace(/on\w+\s*=/gi, '') // イベントハンドラ（onclick等）を除去
		.trim();
}

/**
 * メールアドレスのバリデーション
 */
export function validateEmail(email: string | null | undefined): {
	valid: boolean;
	error?: string;
	sanitized?: string;
} {
	if (!email) {
		return { valid: false, error: m.validation_emailRequired() };
	}

	const sanitized = sanitizeString(email);

	// 基本的なメールアドレスの正規表現
	const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

	if (!emailRegex.test(sanitized)) {
		return { valid: false, error: m.validation_emailInvalid() };
	}

	if (sanitized.length > 255) {
		return { valid: false, error: m.validation_emailTooLong() };
	}

	return { valid: true, sanitized };
}

/**
 * 名前のバリデーション
 */
export function validateName(name: string | null | undefined): {
	valid: boolean;
	error?: string;
	sanitized?: string;
} {
	if (!name) {
		return { valid: false, error: m.validation_nameRequired() };
	}

	const sanitized = sanitizeString(name);

	if (sanitized.length === 0) {
		return { valid: false, error: m.validation_nameRequired() };
	}

	if (sanitized.length > 100) {
		return { valid: false, error: m.validation_nameTooLong({ max: '100' }) };
	}

	return { valid: true, sanitized };
}

/**
 * パスワードのバリデーション
 */
export function validatePassword(password: string | null | undefined): {
	valid: boolean;
	error?: string;
} {
	if (!password) {
		return { valid: false, error: m.validation_passwordRequired() };
	}

	if (password.length < 6) {
		return { valid: false, error: m.validation_passwordTooShort({ min: '6' }) };
	}

	if (password.length > 72) {
		// bcrypt の制限（72バイト）に基づく
		return { valid: false, error: m.validation_passwordTooLong({ max: '72' }) };
	}

	return { valid: true };
}

/**
 * 組織名のバリデーション
 */
export function validateOrganizationName(name: string | null | undefined): {
	valid: boolean;
	error?: string;
	sanitized?: string;
} {
	if (!name) {
		return { valid: false, error: m.validation_orgNameRequired() };
	}

	const sanitized = sanitizeString(name);

	if (sanitized.length === 0) {
		return { valid: false, error: m.validation_orgNameRequired() };
	}

	if (sanitized.length < 2) {
		return { valid: false, error: m.validation_orgNameTooShort({ min: '2' }) };
	}

	if (sanitized.length > 100) {
		return { valid: false, error: m.validation_orgNameTooLong({ max: '100' }) };
	}

	return { valid: true, sanitized };
}

/**
 * セッション名のバリデーション
 */
export function validateSessionName(name: string | null | undefined): {
	valid: boolean;
	error?: string;
	sanitized?: string;
} {
	if (!name) {
		return { valid: false, error: m.validation_sessionNameRequired() };
	}

	const sanitized = sanitizeString(name);

	if (sanitized.length === 0) {
		return { valid: false, error: m.validation_sessionNameRequired() };
	}

	if (sanitized.length > 200) {
		return { valid: false, error: m.validation_sessionNameTooLong({ max: '200' }) };
	}

	return { valid: true, sanitized };
}

/**
 * ゼッケン番号のバリデーション
 */
export function validateBibNumber(bib: string | number | null | undefined): {
	valid: boolean;
	error?: string;
	value?: number;
} {
	if (bib === null || bib === undefined || bib === '') {
		return { valid: false, error: m.validation_bibRequired() };
	}

	const bibNum = typeof bib === 'string' ? parseInt(bib, 10) : bib;

	if (isNaN(bibNum)) {
		return { valid: false, error: m.validation_bibInvalid() };
	}

	if (bibNum < 1 || bibNum > 9999) {
		return { valid: false, error: m.validation_bibRange({ min: '1', max: '9999' }) };
	}

	return { valid: true, value: bibNum };
}

/**
 * スコアのバリデーション
 */
export function validateScore(score: string | number | null | undefined): {
	valid: boolean;
	error?: string;
	value?: number;
} {
	if (score === null || score === undefined || score === '') {
		return { valid: false, error: m.validation_scoreRequired() };
	}

	const scoreNum = typeof score === 'string' ? parseFloat(score) : score;

	if (isNaN(scoreNum)) {
		return { valid: false, error: m.validation_scoreInvalid() };
	}

	if (scoreNum < 0 || scoreNum > 100) {
		return { valid: false, error: m.validation_scoreRange({ min: '0', max: '100' }) };
	}

	return { valid: true, value: scoreNum };
}

// ============================================================
// 採点フォーム用バリデーション（submitScore アクション共通）
// ============================================================

/**
 * ゼッケン番号のバリデーション（採点フォーム用）
 * 文字列全体が正の整数であることを厳密にチェックする（部分パース防止）
 */
export function validateBib(bibRaw: string | null | undefined): {
	success: true;
	value: number;
} | {
	success: false;
	error: string;
} {
	if (!bibRaw || !/^\d+$/.test(bibRaw.trim())) {
		return { success: false, error: m.validation_bibPositiveInteger() };
	}

	const bib = Number(bibRaw);

	if (isNaN(bib) || bib <= 0 || !Number.isInteger(bib)) {
		return { success: false, error: m.validation_bibMustBePositive() };
	}

	return { success: true, value: bib };
}

/**
 * 得点のバリデーション（採点フォーム用）
 * 文字列全体が数値（整数または小数）であることを厳密にチェックする（部分パース防止）
 * NaN・Infinity・非整数をすべて拒否する
 */
export function validateScoreInput(scoreRaw: string | null | undefined): {
	success: true;
	value: number;
} | {
	success: false;
	error: string;
} {
	if (!scoreRaw || !/^-?\d+(\.\d+)?$/.test(scoreRaw.trim())) {
		return { success: false, error: m.validation_scoreInputRequired() };
	}

	const score = Number(scoreRaw);

	if (isNaN(score)) {
		return { success: false, error: m.validation_scoreInputRequired() };
	}

	if (!isFinite(score)) {
		return { success: false, error: m.validation_scoreInputInvalid() };
	}

	if (!Number.isInteger(score)) {
		return { success: false, error: m.validation_scoreInputInteger() };
	}

	return { success: true, value: score };
}

/**
 * 得点範囲チェック（採点フォーム用）
 */
export function validateScoreRange(score: number, minScore: number, maxScore: number): {
	success: true;
} | {
	success: false;
	error: string;
} {
	if (score < minScore || score > maxScore) {
		return { success: false, error: m.validation_scoreInputRange({ min: String(minScore), max: String(maxScore) }) };
	}

	return { success: true };
}

/**
 * UUIDのバリデーション
 */
export function validateUUID(uuid: string | null | undefined): {
	valid: boolean;
	error?: string;
} {
	if (!uuid) {
		return { valid: false, error: m.validation_idRequired() };
	}

	const uuidRegex =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	if (!uuidRegex.test(uuid)) {
		return { valid: false, error: m.validation_idInvalid() };
	}

	return { valid: true };
}

/**
 * 整数IDのバリデーション
 */
export function validateIntegerId(id: string | number | null | undefined): {
	valid: boolean;
	error?: string;
	value?: number;
} {
	if (id === null || id === undefined || id === '') {
		return { valid: false, error: m.validation_idRequired() };
	}

	const idNum = typeof id === 'string' ? parseInt(id, 10) : id;

	if (isNaN(idNum) || idNum < 1) {
		return { valid: false, error: m.validation_idInvalid() };
	}

	return { valid: true, value: idNum };
}

/**
 * 日付のバリデーション
 */
export function validateDate(date: string | null | undefined): {
	valid: boolean;
	error?: string;
	value?: Date;
} {
	if (!date) {
		return { valid: false, error: m.validation_dateRequired() };
	}

	const dateObj = new Date(date);

	if (isNaN(dateObj.getTime())) {
		return { valid: false, error: m.validation_dateInvalid() };
	}

	return { valid: true, value: dateObj };
}

/**
 * 汎用テキストのバリデーション（説明文など）
 */
export function validateText(
	text: string | null | undefined,
	minLength: number = 1,
	maxLength: number = 1000
): {
	valid: boolean;
	error?: string;
	sanitized?: string;
} {
	if (!text) {
		return { valid: false, error: m.validation_textRequired() };
	}

	const sanitized = sanitizeString(text);

	if (sanitized.length === 0) {
		return { valid: false, error: m.validation_textRequired() };
	}

	if (sanitized.length < minLength) {
		return {
			valid: false,
			error: m.validation_textTooShort({ min: String(minLength) })
		};
	}

	if (sanitized.length > maxLength) {
		return {
			valid: false,
			error: m.validation_textTooLong({ max: String(maxLength) })
		};
	}

	return { valid: true, sanitized };
}

/**
 * Allowed redirect paths for Stripe payment flows
 * These paths are safe destinations after Stripe checkout/portal sessions
 */
export const ALLOWED_STRIPE_REDIRECT_PATHS: (string | RegExp)[] = [
	'/dashboard',
	'/account',
	'/pricing',
	'/organizations',
	// Pattern: /organization/[uuid-v4]
	/^\/organization\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	// Pattern: /organization/[uuid-v4]/upgrade
	/^\/organization\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/upgrade$/
];

/**
 * Validates and sanitizes redirect URLs for Stripe payment flows
 * Prevents Open Redirect attacks by enforcing same-origin and path allowlist
 *
 * @param url - URL to validate (relative path or full URL)
 * @param allowedPaths - List of allowed path patterns
 * @returns Validation result with sanitized URL
 */
export function validateRedirectUrl(
	url: string | null | undefined,
	allowedPaths: (string | RegExp)[]
): {
	valid: boolean;
	error?: string;
	sanitizedUrl?: string;
} {
	// 1. Input validation
	if (!url || typeof url !== 'string' || url.trim() === '') {
		return { valid: false, error: 'URL is required' };
	}

	const trimmedUrl = url.trim();

	// 2. Detect relative vs absolute URL
	let parsedUrl: URL;
	let baseOrigin: string;

	try {
		baseOrigin = new URL(PUBLIC_SITE_URL).origin;
	} catch {
		return { valid: false, error: 'PUBLIC_SITE_URL configuration error' };
	}

	// Parse URL (handle both relative and absolute)
	try {
		if (trimmedUrl.startsWith('/')) {
			// Relative path - construct full URL for parsing
			parsedUrl = new URL(trimmedUrl, PUBLIC_SITE_URL);
		} else {
			// Absolute URL
			parsedUrl = new URL(trimmedUrl);
		}
	} catch {
		return { valid: false, error: 'Invalid URL format' };
	}

	// 3. Origin validation (for absolute URLs)
	const urlOrigin = parsedUrl.origin;

	// Allow localhost with any port in development
	// Check hostname specifically to prevent subdomain attacks (e.g., evil.localhost)
	const baseHostname = new URL(baseOrigin).hostname;
	const urlHostname = parsedUrl.hostname;
	const isLocalhost = baseHostname === 'localhost' && urlHostname === 'localhost';

	if (!isLocalhost && urlOrigin !== baseOrigin) {
		return {
			valid: false,
			error: `Origin mismatch: expected ${baseOrigin}, got ${urlOrigin}`
		};
	}

	// 4. Path extraction and normalization
	let pathname = parsedUrl.pathname;

	// Normalize trailing slashes
	if (pathname.length > 1 && pathname.endsWith('/')) {
		pathname = pathname.slice(0, -1);
	}

	// 5. Path validation against allowlist
	const isAllowed = allowedPaths.some((pattern) => {
		if (typeof pattern === 'string') {
			return pattern === pathname;
		} else {
			return pattern.test(pathname);
		}
	});

	if (!isAllowed) {
		return {
			valid: false,
			error: `Path not allowed: ${pathname}`
		};
	}

	// 6. Reconstruct safe URL
	const sanitizedUrl = `${baseOrigin}${pathname}${parsedUrl.search}${parsedUrl.hash}`;

	return {
		valid: true,
		sanitizedUrl
	};
}
