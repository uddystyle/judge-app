import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

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
		const { data: authData, error: authError } = await supabase.auth.signUp({
			email: email,
			password: password,
			options: {
				data: {
					full_name: fullName
				},
				// メール確認後、認証コールバックへリダイレクト
				emailRedirectTo: `${process.env.PUBLIC_SITE_URL || 'http://localhost:5173'}/auth/callback`
			}
		});

		if (authError) {
			// Handle specific errors, like if the user already exists
			if (authError.message.includes('User already registered')) {
				return fail(409, { fullName, email, error: 'このメールアドレスは既に使用されています。' });
			}
			return fail(500, {
				fullName,
				email,
				error: 'サーバーエラー: アカウントの作成に失敗しました。'
			});
		}

		if (!authData.user) {
			return fail(500, {
				fullName,
				email,
				error: 'サーバーエラー: ユーザーの作成後に問題が発生しました。'
			});
		}

		// プロフィールを作成（トリガーがないため手動で作成）
		const { error: profileError } = await supabase.from('profiles').insert({
			id: authData.user.id,
			email: email,
			full_name: fullName
		});

		if (profileError) {
			console.error('Failed to create profile:', profileError);
			// プロフィール作成に失敗してもサインアップは成功しているので、続行
		}

		// --- Success ---
		// On success, redirect the user to a page that tells them to check their email.
		throw redirect(303, '/signup/success');
	}
};
