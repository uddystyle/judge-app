import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { PUBLIC_SITE_URL } from '$env/static/public';
import { validateEmail, validateName, validatePassword } from '$lib/server/validation';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';

/**
 * メールアドレスを正規化（小文字化 + トリム）
 * 大文字小文字の違いや前後の空白を吸収し、データの一貫性を保つ
 */
function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export const actions: Actions = {
	signup: async ({ request, locals: { supabase } }) => {
		// レート制限チェックを最初に実行
		const rateLimitResult = await checkRateLimit(request, rateLimiters?.auth);
		if (!rateLimitResult.success) {
			return rateLimitResult.response;
		}

		const formData = await request.formData();
		const fullName = formData.get('fullName') as string;
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		// --- Validation ---
		// 共通バリデーション関数を使用（XSS対策、長さチェック、形式チェック）
		const nameValidation = validateName(fullName);
		if (!nameValidation.valid) {
			return fail(400, { fullName, email, error: nameValidation.error });
		}

		const emailValidation = validateEmail(email);
		if (!emailValidation.valid) {
			return fail(400, { fullName, email, error: emailValidation.error });
		}

		const passwordValidation = validatePassword(password);
		if (!passwordValidation.valid) {
			return fail(400, { fullName, email, error: passwordValidation.error });
		}

		// サニタイズされた値を使用（XSS対策）
		const sanitizedFullName = nameValidation.sanitized!;
		const sanitizedEmail = emailValidation.sanitized!;

		// メールアドレスを正規化（大文字小文字、空白を統一）
		// signUp()に正規化後のメールを渡すことで、データの一貫性を保つ
		const normalizedEmail = normalizeEmail(sanitizedEmail);

		// --- Create User in Supabase Auth ---
		// Pass full_name in metadata so the database trigger can use it
		console.log('[signup] サインアップ開始:', {
			originalEmail: email,
			sanitizedEmail,
			normalizedEmail,
			emailRedirectTo: `${PUBLIC_SITE_URL}/auth/callback?next=/onboarding/create-organization`
		});

		const { data: authData, error: authError } = await supabase.auth.signUp({
			email: normalizedEmail,
			password: password,
			options: {
				data: {
					full_name: sanitizedFullName
				},
				// メール確認後、認証コールバックへリダイレクト（オンボーディングへの遷移を指定）
				emailRedirectTo: `${PUBLIC_SITE_URL}/auth/callback?next=/onboarding/create-organization`
			}
		});

		console.log('[signup] Supabase signUp レスポンス:', {
			hasUser: !!authData.user,
			hasError: !!authError,
			errorMessage: authError?.message
			// userId と email は個人情報のため、開発環境でのみ出力
			// 本番環境では hasUser, hasError のみで十分
		});

		if (authError) {
			console.error('[signup] signUp error:', {
				code: authError.code,
				message: authError.message,
				status: (authError as any).status
			});

			// エラーコードベースの判定（文字列マッチングではなくコード判定）
			// Supabase Auth Error Codes: https://supabase.com/docs/guides/auth/debugging/error-codes

			// 既存ユーザー: メールアドレスが既に登録されている
			// セキュリティ対策: ユーザー列挙攻撃を防ぐため、成功メッセージを返す
			if (authError.code === 'user_already_exists' ||
			    authError.code === 'email_exists') {
				console.log('[signup] 既存ユーザー検出 - 成功レスポンスを返す（セキュリティ対策）');
				// 既存ユーザーには確認メールが送信されないが、新規ユーザーと同じレスポンスを返す
				return { success: true };
			}

			// メール送信レート制限
			if (authError.code === 'over_email_send_rate_limit' ||
			    (authError as any).status === 429) {
				return fail(429, {
					fullName: sanitizedFullName,
					email: sanitizedEmail,
					error: '確認メールの送信回数が上限に達しました。しばらく待ってから再度お試しください。'
				});
			}

			// フォールバック: error.code が設定されていない場合、message で判定
			// code が設定されている場合は、このブロックは実行されない
			if (!authError.code || authError.code === '') {
				const message = authError.message?.toLowerCase() || '';

				// 既存ユーザーを示す具体的なメッセージパターン
				// セキュリティ対策: ユーザー列挙攻撃を防ぐため、成功メッセージを返す
				if (message.includes('already registered') ||
				    message.includes('already exists') ||
				    message.includes('already been registered')) {
					console.log('[signup] 既存ユーザー検出（メッセージフォールバック） - 成功レスポンスを返す');
					return { success: true };
				}
			}

			// その他の予期しないエラー
			console.error('[signup] Unexpected error code:', authError.code);
			return fail(500, {
				fullName: sanitizedFullName,
				email: sanitizedEmail,
				error: 'サーバーエラー: アカウントの作成に失敗しました。'
			});
		}

		// Supabaseは既存ユーザーの場合、エラーなしで匿名化ユーザーを返す場合がある
		// identitiesが空なら既存登録済みとして扱う
		// セキュリティ対策: ユーザー列挙攻撃を防ぐため、成功メッセージを返す
		if (authData.user && Array.isArray(authData.user.identities) && authData.user.identities.length === 0) {
			console.log('[signup] 既存ユーザーを検出（identitiesが空） - 成功レスポンスを返す:', {
				email: authData.user.email,
				userId: authData.user.id,
				reason: 'このケースではメールは送信されません'
			});
			return { success: true };
		}

		if (!authData.user) {
			return fail(500, {
				fullName: sanitizedFullName,
				email: sanitizedEmail,
				error: 'サーバーエラー: ユーザーの作成後に問題が発生しました。'
			});
		}

		// 【セキュリティチェック】session が null であることを確認
		// session が存在する場合、Supabase設定でメール確認が無効になっている可能性がある
		if (authData.session) {
			console.error('[signup] SECURITY WARNING: Session was returned immediately after signup.', {
				userId: authData.user.id,
				email: authData.user.email,
				emailConfirmedAt: authData.user.email_confirmed_at,
				message: 'Supabase "Confirm email" setting may be disabled. Email ownership verification is required for security.'
			});
			return fail(500, {
				fullName: sanitizedFullName,
				email: sanitizedEmail,
				error: 'システム設定エラー: メール確認が必要です。管理者に連絡してください。'
			});
		}

		console.log('[signup] User created, email confirmation required:', {
			hasSession: false,
			emailConfirmedAt: authData.user.email_confirmed_at
			// userId と email は個人情報のため出力しない（GDPR/プライバシー保護）
		});

		// プロフィールはメール認証後のオンボーディング時に作成されます
		// これにより、RLSポリシー（TO authenticated）に準拠し、
		// Supabaseの設定に依存しない確実な動作を保証します

		// --- Success ---
		// On success, redirect the user to a page that tells them to check their email.
		throw redirect(303, '/signup/success');
	}
};
