import { json, redirect, error, isRedirect, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';
import { env } from '$env/dynamic/private';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';
import { validateRedirectUrl, validateOrganizationName, ALLOWED_STRIPE_REDIRECT_PATHS } from '$lib/server/validation';

// Stripe Price IDのマッピング
// 注意: 実際のPrice IDはStripeダッシュボードで作成後、環境変数に設定してください
const PRICE_IDS: Record<string, { month: string; year: string }> = {
	basic: {
		month: env.STRIPE_PRICE_BASIC_MONTH || 'price_basic_month_placeholder',
		year: env.STRIPE_PRICE_BASIC_YEAR || 'price_basic_year_placeholder'
	},
	standard: {
		month: env.STRIPE_PRICE_STANDARD_MONTH || 'price_standard_month_placeholder',
		year: env.STRIPE_PRICE_STANDARD_YEAR || 'price_standard_year_placeholder'
	},
	premium: {
		month: env.STRIPE_PRICE_PREMIUM_MONTH || 'price_premium_month_placeholder',
		year: env.STRIPE_PRICE_PREMIUM_YEAR || 'price_premium_year_placeholder'
	}
};

// プランの最大メンバー数
const MAX_MEMBERS: Record<string, number> = {
	basic: 10,
	standard: 30,
	premium: 100
};

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
		const { organizationName, planType, billingInterval, returnUrl, cancelUrl, couponCode } =
			await request.json();

		// バリデーション
		if (!organizationName || !planType || !billingInterval || !returnUrl || !cancelUrl) {
			throw error(400, '必須パラメータが不足しています。');
		}

		// Security: Validate and sanitize organization name
		const orgNameValidation = validateOrganizationName(organizationName);
		if (!orgNameValidation.valid) {
			throw error(400, orgNameValidation.error || '無効な組織名です。');
		}
		const sanitizedOrgName = orgNameValidation.sanitized!;

		if (!['basic', 'standard', 'premium'].includes(planType)) {
			throw error(400, '無効なプランタイプです。');
		}

		if (!['month', 'year'].includes(billingInterval)) {
			throw error(400, '無効な請求間隔です。');
		}

		// Security: Validate redirect URLs to prevent Open Redirect attacks
		const returnValidation = validateRedirectUrl(returnUrl, ALLOWED_STRIPE_REDIRECT_PATHS);
		if (!returnValidation.valid) {
			console.error('[Organization Checkout] Invalid returnUrl:', returnUrl, 'Error:', returnValidation.error);
			throw error(400, `無効なreturnUrlです: ${returnValidation.error}`);
		}

		const cancelValidation = validateRedirectUrl(cancelUrl, ALLOWED_STRIPE_REDIRECT_PATHS);
		if (!cancelValidation.valid) {
			console.error('[Organization Checkout] Invalid cancelUrl:', cancelUrl, 'Error:', cancelValidation.error);
			throw error(400, `無効なcancelUrlです: ${cancelValidation.error}`);
		}

		const sanitizedReturnUrl = returnValidation.sanitizedUrl!;
		const sanitizedCancelUrl = cancelValidation.sanitizedUrl!;

		console.log('[Organization Checkout API] ユーザー:', user.id);
		console.log('[Organization Checkout API] 組織名:', sanitizedOrgName);
		console.log('[Organization Checkout API] プラン:', planType, billingInterval);

		// 3. Price IDを取得
		const priceId = PRICE_IDS[planType][billingInterval];

		if (priceId.includes('placeholder')) {
			// 詳細はログのみに出力（セキュリティ：内部実装の詳細を隠す）
			console.error('[Organization Checkout API] CRITICAL: Stripe Price ID not configured!');
			console.error('[Organization Checkout API] planType:', planType, 'billingInterval:', billingInterval);

			// クライアントには汎用的なメッセージ
			throw error(500, 'サービスの設定エラーが発生しました。管理者に連絡してください。');
		}

		// 4. ユーザー情報を取得
		const { data: profile } = await supabase
			.from('profiles')
			.select('full_name, email')
			.eq('id', user.id)
			.single();

		// 5. Stripe Customerを作成
		const customer = await stripe.customers.create({
			email: user.email || profile?.email || undefined,
			name: profile?.full_name || undefined,
			metadata: {
				user_id: user.id,
				organization_name: sanitizedOrgName,
				is_organization: 'true'
			}
		});

		console.log('[Organization Checkout API] 新しいCustomerを作成:', customer.id);

		// 6. Stripe Checkout Sessionを作成
		const sessionParams: any = {
			customer: customer.id,
			mode: 'subscription',
			payment_method_types: ['card'],
			line_items: [
				{
					price: priceId,
					quantity: 1
				}
			],
			success_url: sanitizedReturnUrl,
			cancel_url: sanitizedCancelUrl,
			metadata: {
				user_id: user.id,
				organization_name: sanitizedOrgName,
				plan_type: planType,
				max_members: MAX_MEMBERS[planType].toString(),
				billing_interval: billingInterval,
				is_organization: 'true'
			},
			subscription_data: {
				metadata: {
					user_id: user.id,
					organization_name: sanitizedOrgName,
					plan_type: planType,
					max_members: MAX_MEMBERS[planType].toString(),
					is_organization: 'true'
				}
			}
		};

		// Security: Validate coupon code
		if (couponCode) {
			// 長さ制限（Stripeのcoupon IDは通常50文字以内）
			if (typeof couponCode !== 'string' || couponCode.length > 100) {
				throw error(400, '無効なクーポンコードです。');
			}

			// 英数字、アンダースコア、ハイフンのみ許可
			if (!/^[a-zA-Z0-9_-]+$/.test(couponCode)) {
				throw error(400, '無効なクーポンコードです。');
			}

			sessionParams.discounts = [{ coupon: couponCode }];
			// ログには最初の10文字のみ出力（プライバシー保護）
			const maskedCoupon = couponCode.length > 10
				? couponCode.substring(0, 10) + '...'
				: couponCode;
			console.log('[Organization Checkout API] クーポンコード適用:', maskedCoupon);
		}

		const session = await stripe.checkout.sessions.create(sessionParams);

		console.log('[Organization Checkout API] Checkout Session作成成功:', session.id);

		// 7. Checkout URLを返す
		return json({ url: session.url });
	} catch (err: any) {
		// SvelteKitのredirectやerrorは再throw（正常な制御フロー）
		if (isRedirect(err) || isHttpError(err)) {
			throw err;
		}

		// 詳細なエラーはログのみに出力（セキュリティ：情報漏洩防止）
		console.error('[Organization Checkout API] エラー:', err.message);
		console.error('[Organization Checkout API] エラータイプ:', err.type);
		console.error('[Organization Checkout API] エラーコード:', err.code);

		// クライアントには汎用的なメッセージのみ返す
		throw error(500, 'Checkout Sessionの作成に失敗しました。しばらくしてから再度お試しください。');
	}
};
