import { json, redirect, error, isRedirect, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';
import { validateRedirectUrl, ALLOWED_STRIPE_REDIRECT_PATHS } from '$lib/server/validation';

export const POST: RequestHandler = async ({ request, locals: { supabase } }) => {
	// レート制限チェックを最初に実行
	const rateLimitResult = await checkRateLimit(request, rateLimiters?.api);
	if (!rateLimitResult.success) {
		return rateLimitResult.response;
	}

	// 1. ユーザー認証確認
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	try {
		// 2. リクエストボディの取得
		const { returnUrl } = await request.json();

		if (!returnUrl) {
			throw error(400, 'returnUrl は必須です。');
		}

		// Security: Validate redirect URL to prevent Open Redirect attacks
		const returnValidation = validateRedirectUrl(returnUrl, ALLOWED_STRIPE_REDIRECT_PATHS);
		if (!returnValidation.valid) {
			console.error('[Portal API] Invalid returnUrl:', returnUrl, 'Error:', returnValidation.error);
			throw error(400, `無効なreturnUrlです: ${returnValidation.error}`);
		}

		const sanitizedReturnUrl = returnValidation.sanitizedUrl!;

		console.log('[Portal API] ユーザー:', user.id);

		// 3. subscriptionsテーブルからCustomer ID取得（個人用のみ）
		const { data: subscription, error: subError } = await supabase
			.from('subscriptions')
			.select('stripe_customer_id')
			.eq('user_id', user.id)
			.is('organization_id', null)
			.single();

		if (subError || !subscription?.stripe_customer_id) {
			console.error('[Portal API] サブスクリプション情報が見つかりません:', subError);
			throw error(404, 'サブスクリプション情報が見つかりません。');
		}

		console.log('[Portal API] Customer ID:', subscription.stripe_customer_id);

		// 4. Stripe Customer Portal Sessionを作成
		const portalSession = await stripe.billingPortal.sessions.create({
			customer: subscription.stripe_customer_id,
			return_url: sanitizedReturnUrl
		});

		console.log('[Portal API] Portal Session作成成功:', portalSession.id);

		// 5. Portal URLを返す
		return json({ url: portalSession.url });
	} catch (err: any) {
		// SvelteKitのredirectやerrorは再throw（正常な制御フロー）
		if (isRedirect(err) || isHttpError(err)) {
			throw err;
		}
		console.error('[Portal API] エラー詳細:');
		console.error('  メッセージ:', err.message);
		console.error('  タイプ:', err.type);
		console.error('  コード:', err.code);
		console.error('  ステータスコード:', err.statusCode);
		console.error('  完全なエラー:', JSON.stringify(err, null, 2));
		throw error(500, err.message || 'Customer Portal Sessionの作成に失敗しました。');
	}
};
