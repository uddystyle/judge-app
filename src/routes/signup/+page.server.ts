import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { PUBLIC_SITE_URL } from '$env/static/public';

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

		// --- Create User in Supabase Auth ---
		// Pass full_name in metadata so the database trigger can use it
		console.log('[signup] サインアップ開始:', {
			email,
			emailRedirectTo: `${PUBLIC_SITE_URL}/auth/callback?next=/onboarding/create-organization`
		});

		const { data: authData, error: authError } = await supabase.auth.signUp({
			email: email,
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
				message: authError.message,
				status: (authError as any).status,
				code: (authError as any).code
			});
			// 既存ユーザー
			if (
				authError.message.includes('User already registered') ||
				authError.message.toLowerCase().includes('already registered')
			) {
				return fail(409, { fullName, email, error: 'このメールアドレスは既に使用されています。' });
			}
			// メール送信レート制限
			if (
				(authError as any).status === 429 ||
				authError.message.toLowerCase().includes('rate limit')
			) {
				return fail(429, {
					fullName,
					email,
					error:
						'確認メールの送信回数が上限に達しました。しばらく待ってから再度お試しください。'
				});
			}
			return fail(500, {
				fullName,
				email,
				error: 'サーバーエラー: アカウントの作成に失敗しました。'
			});
		}

		// --- メール送信状態の診断ログ ---
		console.log('[signup] signUp 成功:', {
			userId: authData.user?.id,
			email: authData.user?.email,
			hasSession: !!authData.session,
			emailConfirmedAt: authData.user?.email_confirmed_at,
			identitiesCount: authData.user?.identities?.length || 0,
			userMetadata: authData.user?.user_metadata
		});

		// セッションが即座に作成されている場合は、メール確認がスキップされている（Autoconfirm有効）
		if (authData.session) {
			console.warn('[signup] ⚠️ メール確認なしでセッションが作成されました。Supabase設定でAutoconfirmが有効になっている可能性があります。');
		} else {
			console.log('[signup] ✓ メール確認が必要です。確認メールが送信されているはずです。');
		}

		// Supabaseは既存ユーザーの場合、エラーなしで匿名化ユーザーを返す場合がある
		// identitiesが空なら既存登録済みとして扱う
		if (authData.user && Array.isArray(authData.user.identities) && authData.user.identities.length === 0) {
			console.warn('[signup] ⚠️ 既存ユーザーを検出（identitiesが空）:', {
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

		// Autoconfirm有効時はセッションが作成されるため、確認メール待ち画面へは遷移しない
		if (authData.session || authData.user?.email_confirmed_at) {
			console.log('[signup] Autoconfirmまたは既にメール確認済み。オンボーディングへ遷移します');
			throw redirect(303, '/onboarding/create-organization');
		}

		if (!authData.user) {
			return fail(500, {
				fullName,
				email,
				error: 'サーバーエラー: ユーザーの作成後に問題が発生しました。'
			});
		}

		// プロフィールはメール認証後のオンボーディング時に作成されます
		// これにより、RLSポリシー（TO authenticated）に準拠し、
		// Supabaseの設定に依存しない確実な動作を保証します

		// --- Success ---
		// On success, redirect the user to a page that tells them to check their email.
		throw redirect(303, '/signup/success');
	}
};
