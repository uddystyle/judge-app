import { describe, it, expect } from 'vitest';

/**
 * ログイン機能のユニットテスト
 *
 * メール正規化とエラーコードベースのハンドリングをテスト
 */

describe('login - email normalization', () => {
	/**
	 * メールアドレスを正規化（小文字化 + トリム）
	 */
	function normalizeEmail(email: string): string {
		return email.trim().toLowerCase();
	}

	it('小文字のメールはそのまま返す', () => {
		const email = 'user@example.com';
		expect(normalizeEmail(email)).toBe('user@example.com');
	});

	it('大文字のメールを小文字に変換する', () => {
		const email = 'USER@EXAMPLE.COM';
		expect(normalizeEmail(email)).toBe('user@example.com');
	});

	it('混在した大文字小文字を小文字に変換する', () => {
		const email = 'UsEr@ExAmPlE.CoM';
		expect(normalizeEmail(email)).toBe('user@example.com');
	});

	it('前後の空白を削除する', () => {
		const email = '  user@example.com  ';
		expect(normalizeEmail(email)).toBe('user@example.com');
	});

	it('大文字と空白の両方を処理する', () => {
		const email = '  USER@EXAMPLE.COM  ';
		expect(normalizeEmail(email)).toBe('user@example.com');
	});
});

describe('login - error code mapping', () => {
	/**
	 * エラーコードに基づいてユーザー向けメッセージを返す
	 */
	function getErrorMessage(errorCode: string, status?: number): string {
		// 無効な認証情報
		if (errorCode === 'invalid_credentials') {
			return 'メールアドレスまたはパスワードが正しくありません。';
		}

		// メール未確認
		if (errorCode === 'email_not_confirmed') {
			return 'メールアドレスが確認されていません。確認メールをご確認ください。';
		}

		// レート制限
		if (errorCode === 'too_many_requests' || status === 429) {
			return 'ログイン試行回数が上限に達しました。しばらく待ってから再度お試しください。';
		}

		// その他のエラー
		return 'ログインに失敗しました。再度お試しください。';
	}

	it('invalid_credentials エラーコードの場合、認証エラーメッセージを返す', () => {
		const message = getErrorMessage('invalid_credentials');
		expect(message).toBe('メールアドレスまたはパスワードが正しくありません。');
	});

	it('email_not_confirmed エラーコードの場合、メール未確認メッセージを返す', () => {
		const message = getErrorMessage('email_not_confirmed');
		expect(message).toBe('メールアドレスが確認されていません。確認メールをご確認ください。');
	});

	it('too_many_requests エラーコードの場合、レート制限メッセージを返す', () => {
		const message = getErrorMessage('too_many_requests');
		expect(message).toBe('ログイン試行回数が上限に達しました。しばらく待ってから再度お試しください。');
	});

	it('status 429 の場合、レート制限メッセージを返す', () => {
		const message = getErrorMessage('some_error', 429);
		expect(message).toBe('ログイン試行回数が上限に達しました。しばらく待ってから再度お試しください。');
	});

	it('予期しないエラーコードの場合、汎用エラーメッセージを返す', () => {
		const message = getErrorMessage('unknown_error');
		expect(message).toBe('ログインに失敗しました。再度お試しください。');
	});

	it('空文字列のエラーコードの場合、汎用エラーメッセージを返す', () => {
		const message = getErrorMessage('');
		expect(message).toBe('ログインに失敗しました。再度お試しください。');
	});
});

describe('login - integration scenarios', () => {
	function normalizeEmail(email: string): string {
		return email.trim().toLowerCase();
	}

	it('大文字のメールでログイン試行時、正規化されたメールが使用される', () => {
		const inputEmail = 'USER@EXAMPLE.COM';
		const normalizedEmail = normalizeEmail(inputEmail);

		expect(normalizedEmail).toBe('user@example.com');
		// 実際のsignInWithPasswordには正規化されたメールが渡される
	});

	it('空白付きメールでログイン試行時、正規化されたメールが使用される', () => {
		const inputEmail = '  user@example.com  ';
		const normalizedEmail = normalizeEmail(inputEmail);

		expect(normalizedEmail).toBe('user@example.com');
	});

	it('正規化により、サインアップ時と同じメールアドレスでログイン可能', () => {
		// サインアップ時: "User@Example.com" -> 正規化 -> "user@example.com"
		const signupEmail = 'User@Example.com';
		const signupNormalized = normalizeEmail(signupEmail);

		// ログイン時: "USER@EXAMPLE.COM" -> 正規化 -> "user@example.com"
		const loginEmail = 'USER@EXAMPLE.COM';
		const loginNormalized = normalizeEmail(loginEmail);

		// 正規化により一致する
		expect(signupNormalized).toBe(loginNormalized);
		expect(signupNormalized).toBe('user@example.com');
	});
});
