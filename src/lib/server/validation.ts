/**
 * サーバーサイドバリデーションユーティリティ
 * XSS、SQLインジェクション、その他の攻撃からの保護
 */

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
} {
	if (!email) {
		return { valid: false, error: 'メールアドレスを入力してください。' };
	}

	const sanitized = sanitizeString(email);

	// 基本的なメールアドレスの正規表現
	const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

	if (!emailRegex.test(sanitized)) {
		return { valid: false, error: '有効なメールアドレスを入力してください。' };
	}

	if (sanitized.length > 255) {
		return { valid: false, error: 'メールアドレスが長すぎます。' };
	}

	return { valid: true };
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
		return { valid: false, error: '名前を入力してください。' };
	}

	const sanitized = sanitizeString(name);

	if (sanitized.length === 0) {
		return { valid: false, error: '名前を入力してください。' };
	}

	if (sanitized.length > 100) {
		return { valid: false, error: '名前は100文字以内で入力してください。' };
	}

	return { valid: true, sanitized };
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
		return { valid: false, error: '組織名を入力してください。' };
	}

	const sanitized = sanitizeString(name);

	if (sanitized.length === 0) {
		return { valid: false, error: '組織名を入力してください。' };
	}

	if (sanitized.length < 2) {
		return { valid: false, error: '組織名は2文字以上で入力してください。' };
	}

	if (sanitized.length > 100) {
		return { valid: false, error: '組織名は100文字以内で入力してください。' };
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
		return { valid: false, error: 'セッション名を入力してください。' };
	}

	const sanitized = sanitizeString(name);

	if (sanitized.length === 0) {
		return { valid: false, error: 'セッション名を入力してください。' };
	}

	if (sanitized.length > 200) {
		return { valid: false, error: 'セッション名は200文字以内で入力してください。' };
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
		return { valid: false, error: 'ゼッケン番号を入力してください。' };
	}

	const bibNum = typeof bib === 'string' ? parseInt(bib, 10) : bib;

	if (isNaN(bibNum)) {
		return { valid: false, error: 'ゼッケン番号は数値で入力してください。' };
	}

	if (bibNum < 1 || bibNum > 9999) {
		return { valid: false, error: 'ゼッケン番号は1〜9999の範囲で入力してください。' };
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
		return { valid: false, error: 'スコアを入力してください。' };
	}

	const scoreNum = typeof score === 'string' ? parseFloat(score) : score;

	if (isNaN(scoreNum)) {
		return { valid: false, error: 'スコアは数値で入力してください。' };
	}

	if (scoreNum < 0 || scoreNum > 100) {
		return { valid: false, error: 'スコアは0〜100の範囲で入力してください。' };
	}

	return { valid: true, value: scoreNum };
}

/**
 * UUIDのバリデーション
 */
export function validateUUID(uuid: string | null | undefined): {
	valid: boolean;
	error?: string;
} {
	if (!uuid) {
		return { valid: false, error: 'IDが指定されていません。' };
	}

	const uuidRegex =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	if (!uuidRegex.test(uuid)) {
		return { valid: false, error: '無効なIDです。' };
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
		return { valid: false, error: 'IDが指定されていません。' };
	}

	const idNum = typeof id === 'string' ? parseInt(id, 10) : id;

	if (isNaN(idNum) || idNum < 1) {
		return { valid: false, error: '無効なIDです。' };
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
		return { valid: false, error: '日付を入力してください。' };
	}

	const dateObj = new Date(date);

	if (isNaN(dateObj.getTime())) {
		return { valid: false, error: '有効な日付を入力してください。' };
	}

	return { valid: true, value: dateObj };
}

/**
 * 汎用テキストのバリデーション（説明文など）
 */
export function validateText(
	text: string | null | undefined,
	maxLength: number = 1000
): {
	valid: boolean;
	error?: string;
	sanitized?: string;
} {
	if (!text) {
		return { valid: false, error: 'テキストを入力してください。' };
	}

	const sanitized = sanitizeString(text);

	if (sanitized.length === 0) {
		return { valid: false, error: 'テキストを入力してください。' };
	}

	if (sanitized.length > maxLength) {
		return {
			valid: false,
			error: `テキストは${maxLength}文字以内で入力してください。`
		};
	}

	return { valid: true, sanitized };
}
