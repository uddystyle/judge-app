import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { PUBLIC_SITE_URL } from '$env/static/public';

/**
 * メールアドレスを正規化（小文字化 + トリム）
 * 大文字小文字の違いや前後の空白を吸収し、データの一貫性を保つ
 */
function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export const actions: Actions = {
	signup: async ({ request, locals: { supabase } }) => {
		const formData = await request.formData();
		const fullName = formData.get('fullName') as string;
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		// --- Validation ---
		if (!fullName || fullName.trim().length === 0) {
			return fail(400, { fullName, email, error: '氏名を入力してください。' });
		}
		if (!email) {
			return fail(400, { fullName, email, error: 'メールアドレスを入力してください。' });
		}
		if (!password || password.length < 6) {
			return fail(400, { fullName, email, error: 'パスワードは6文字以上で入力してください。' });
		}

		// メールアドレスを正規化（大文字小文字、空白を統一）
		// signUp()に正規化後のメールを渡すことで、データの一貫性を保つ
		const normalizedEmail = normalizeEmail(email);

		// --- Create User in Supabase Auth ---
		// Pass full_name in metadata so the database trigger can use it
		console.log('[signup] サインアップ開始:', {
			originalEmail: email,
			normalizedEmail,
			emailRedirectTo: `${PUBLIC_SITE_URL}/auth/callback?next=/onboarding/create-organization`
		});

		const { data: authData, error: authError } = await supabase.auth.signUp({
			email: normalizedEmail,
			password: password,
			options: {
				data: {
					full_name: fullName
				},
				// メール確認後、認証コールバックへリダイレクト（オンボーディングへの遷移を指定）
				emailRedirectTo: `${PUBLIC_SITE_URL}/auth/callback?next=/onboarding/create-organization`
			}
		});

		console.log('[signup] Supabase signUp レスポンス:', {
			hasUser: !!authData.user,
			userId: authData.user?.id,
			email: authData.user?.email,
			hasError: !!authError,
			errorMessage: authError?.message,
			// 完全なレスポンスをログ出力
			fullResponse: JSON.stringify(authData, null, 2)
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
			if (authError.code === 'user_already_exists' ||
			    authError.code === 'email_exists') {
				return fail(409, { fullName, email, error: 'このメールアドレスは既に使用されています。' });
			}

			// メール送信レート制限
			if (authError.code === 'over_email_send_rate_limit' ||
			    (authError as any).status === 429) {
				return fail(429, {
					fullName,
					email,
					error: '確認メールの送信回数が上限に達しました。しばらく待ってから再度お試しください。'
				});
			}

			// その他のエラー
			console.error('[signup] Unexpected error code:', authError.code);
			return fail(500, {
				fullName,
				email,
				error: 'サーバーエラー: アカウントの作成に失敗しました。'
			});
		}

		// Supabaseは既存ユーザーの場合、エラーなしで匿名化ユーザーを返す場合がある
		// identitiesが空なら既存登録済みとして扱う
		if (authData.user && Array.isArray(authData.user.identities) && authData.user.identities.length === 0) {
			console.warn('[signup] 既存ユーザーを検出（identitiesが空）:', {
				email: authData.user.email,
				userId: authData.user.id,
				reason: 'このケースではメールは送信されません'
			});
			return fail(409, {
				fullName,
				email,
				error: 'このメールアドレスは既に登録されています。ログインしてください。'
			});
		}

		if (!authData.user) {
			return fail(500, {
				fullName,
				email,
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
				fullName,
				email,
				error: 'システム設定エラー: メール確認が必要です。管理者に連絡してください。'
			});
		}

		console.log('[signup] User created, email confirmation required:', {
			userId: authData.user.id,
			email: authData.user.email,
			hasSession: false,
			emailConfirmedAt: authData.user.email_confirmed_at
		});

		// プロフィールはメール認証後のオンボーディング時に作成されます
		// これにより、RLSポリシー（TO authenticated）に準拠し、
		// Supabaseの設定に依存しない確実な動作を保証します

		// --- Success ---
		// On success, redirect the user to a page that tells them to check their email.
		throw redirect(303, '/signup/success');
	}
};
