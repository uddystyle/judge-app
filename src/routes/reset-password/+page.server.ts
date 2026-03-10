import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { validateEmail } from '$lib/server/validation';
import { PUBLIC_SITE_URL } from '$env/static/public';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';

/**
 * メールアドレスを正規化（小文字化 + トリム）
 */
function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export const actions: Actions = {
	default: async ({ request, locals: { supabase } }) => {
		// レート制限チェックを最初に実行
		const rateLimitResult = await checkRateLimit(request, rateLimiters?.auth);
		if (!rateLimitResult.success) {
			return rateLimitResult.response;
		}

		const formData = await request.formData();
		const emailRaw = formData.get('email') as string;

		// バリデーション
		const emailValidation = validateEmail(emailRaw);
		if (!emailValidation.valid) {
			return fail(400, {
				email: emailRaw || '',
				error: emailValidation.error || 'メールアドレスが無効です。'
			});
		}

		const sanitizedEmail = emailValidation.sanitized!;
		const email = normalizeEmail(sanitizedEmail);

		// パスワードリセットメールを送信
		// auth/callbackを経由してトークン交換を行い、confirmページへ遷移させる
		const { error } = await supabase.auth.resetPasswordForEmail(email, {
			redirectTo: `${PUBLIC_SITE_URL}/auth/callback?next=/reset-password/confirm`
		});

		if (error) {
			console.error('[reset-password] エラー:', error);
			console.error('[reset-password] エラーコード:', error.code);
			console.error('[reset-password] エラーメッセージ:', error.message);
			console.error('[reset-password] エラー詳細:', JSON.stringify(error, null, 2));
			// セキュリティ上の理由から、メールアドレスが存在しない場合でも成功メッセージを表示
			// （アカウントの存在を推測されないようにするため）
		}

		// 常に成功を返す（セキュリティ対策）
		return {
			success: true,
			email
		};
	}
};
