import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { validatePassword } from '$lib/server/validation';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';

/**
 * パスワードリセット確認ページのロード処理
 * メールのリンクから飛んできた際にアクセストークンを確認
 */
export const load: PageServerLoad = async ({ url, locals: { supabase } }) => {
	// URLパラメータからerrorとerror_descriptionを取得
	const error = url.searchParams.get('error');
	const errorDescription = url.searchParams.get('error_description');

	if (error) {
		console.error('[reset-password/confirm] URLエラー:', error, errorDescription);
		return {
			error: errorDescription || 'リンクが無効または期限切れです。'
		};
	}

	// 認証状態を確認
	const {
		data: { user }
	} = await supabase.auth.getUser();

	// ユーザーが認証されていない場合はエラー
	if (!user) {
		return {
			error: 'リンクが無効または期限切れです。再度パスワードリセットをお試しください。'
		};
	}

	return {
		user
	};
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase } }) => {
		// レート制限チェックを最初に実行
		const rateLimitResult = await checkRateLimit(request, rateLimiters?.auth);
		if (!rateLimitResult.success) {
			return rateLimitResult.response;
		}

		const formData = await request.formData();
		const password = formData.get('password') as string;
		const confirmPassword = formData.get('confirmPassword') as string;

		// パスワード一致確認
		if (password !== confirmPassword) {
			return fail(400, {
				error: 'パスワードが一致しません。'
			});
		}

		// パスワードバリデーション
		const passwordValidation = validatePassword(password);
		if (!passwordValidation.valid) {
			return fail(400, {
				error: passwordValidation.error || 'パスワードが無効です。'
			});
		}

		// パスワード更新
		const { error } = await supabase.auth.updateUser({
			password
		});

		if (error) {
			console.error('[reset-password/confirm] パスワード更新エラー:', error);

			// エラーコード別の処理
			if (error.code === 'same_password') {
				return fail(400, {
					error: '新しいパスワードは以前のパスワードと異なるものを設定してください。'
				});
			}

			return fail(500, {
				error: 'パスワードの更新に失敗しました。再度お試しください。'
			});
		}

		console.log('[reset-password/confirm] パスワード更新成功');

			// パスワード変更後は全セッションを失効させる
			// 他タブ/他デバイスの既存セッションを継続利用させないため
			const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
			if (signOutError) {
				console.error('[reset-password/confirm] グローバルサインアウトエラー:', signOutError);
				// 失効に失敗しても、パスワード更新自体は成功しているため処理は継続
			}

		// ログインページにリダイレクト
		throw redirect(303, '/login?success=password-reset');
	}
};
