import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';
import { env } from '$env/dynamic/private';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';
import { validateRedirectUrl, ALLOWED_STRIPE_REDIRECT_PATHS } from '$lib/server/validation';

// Stripe Price IDのマッピング
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
		throw error(401, '認証が必要です。');
	}

	try {
		// 2. リクエストボディの取得
		const { organizationId, planType, billingInterval, returnUrl, cancelUrl, couponCode } =
			await request.json();

		// バリデーション
		if (!organizationId || !planType || !billingInterval || !returnUrl || !cancelUrl) {
			throw error(400, '必須パラメータが不足しています。');
		}

		if (!['basic', 'standard', 'premium'].includes(planType)) {
			throw error(400, '無効なプランタイプです。');
		}

		if (!['month', 'year'].includes(billingInterval)) {
			throw error(400, '無効な請求間隔です。');
		}

		// Security: Validate redirect URLs to prevent Open Redirect attacks
		const returnValidation = validateRedirectUrl(returnUrl, ALLOWED_STRIPE_REDIRECT_PATHS);
		if (!returnValidation.valid) {
			console.error('[Organization Upgrade] Invalid returnUrl:', returnUrl, 'Error:', returnValidation.error);
			throw error(400, `無効なreturnUrlです: ${returnValidation.error}`);
		}

		const cancelValidation = validateRedirectUrl(cancelUrl, ALLOWED_STRIPE_REDIRECT_PATHS);
		if (!cancelValidation.valid) {
			console.error('[Organization Upgrade] Invalid cancelUrl:', cancelUrl, 'Error:', cancelValidation.error);
			throw error(400, `無効なcancelUrlです: ${cancelValidation.error}`);
		}

		const sanitizedReturnUrl = returnValidation.sanitizedUrl!;
		const sanitizedCancelUrl = cancelValidation.sanitizedUrl!;

		console.log('[Organization Upgrade API] ユーザー:', user.id);
		console.log('[Organization Upgrade API] 組織ID:', organizationId);
		console.log('[Organization Upgrade API] プラン:', planType, billingInterval);

		// 3. 組織情報を取得
		const { data: organization } = await supabase
			.from('organizations')
			.select('id, name, plan_type, stripe_customer_id')
			.eq('id', organizationId)
			.single();

		if (!organization) {
			throw error(404, '組織が見つかりません。');
		}

		// 4. 組織の管理者権限を確認
		const { data: member } = await supabase
			.from('organization_members')
			.select('role')
			.eq('organization_id', organizationId)
			.eq('user_id', user.id)
			.single();

		if (!member || member.role !== 'admin') {
			throw error(403, '組織の管理者権限が必要です。');
		}

		// 5. Price IDを取得
		const priceId = PRICE_IDS[planType][billingInterval];

		if (priceId.includes('placeholder')) {
			// 詳細はログのみに出力（セキュリティ：内部実装の詳細を隠す）
			console.error('[Organization Upgrade API] CRITICAL: Stripe Price ID not configured!');
			console.error('[Organization Upgrade API] planType:', planType, 'billingInterval:', billingInterval);

			// クライアントには汎用的なメッセージ
			throw error(500, 'サービスの設定エラーが発生しました。管理者に連絡してください。');
		}

		// 6. ユーザー情報を取得
		const { data: profile } = await supabase
			.from('profiles')
			.select('full_name, email')
			.eq('id', user.id)
			.single();

		// 7. Stripe Customerを作成または取得
		let customerId = organization.stripe_customer_id;

		if (!customerId) {
			const customer = await stripe.customers.create({
				email: user.email || profile?.email || undefined,
				name: profile?.full_name || undefined,
				metadata: {
					user_id: user.id,
					organization_id: organizationId,
					organization_name: organization.name,
					is_organization: 'true'
				}
			});

			customerId = customer.id;
			console.log('[Organization Upgrade API] 新しいCustomerを作成:', customerId);

			// Customerをorganizationsテーブルに保存
			await supabase
				.from('organizations')
				.update({ stripe_customer_id: customerId })
				.eq('id', organizationId);
		}

		// 8. Stripe Checkout Sessionを作成
		const sessionParams: any = {
			customer: customerId,
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
				organization_id: organizationId,
				organization_name: organization.name,
				plan_type: planType,
				max_members: MAX_MEMBERS[planType].toString(),
				billing_interval: billingInterval,
				is_organization: 'true',
				is_upgrade: 'true'
			},
			subscription_data: {
				metadata: {
					user_id: user.id,
					organization_id: organizationId,
					organization_name: organization.name,
					plan_type: planType,
					max_members: MAX_MEMBERS[planType].toString(),
					is_organization: 'true',
					is_upgrade: 'true'
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
			console.log('[Organization Upgrade API] クーポンコード適用:', maskedCoupon);
		}

		const session = await stripe.checkout.sessions.create(sessionParams);

		console.log('[Organization Upgrade API] Checkout Session作成成功:', session.id);

		// 9. Checkout URLを返す
		return json({ url: session.url });
	} catch (err: any) {
		// 詳細なエラーはログのみに出力（セキュリティ：情報漏洩防止、個人情報保護）
		console.error('[Organization Upgrade API] エラー:', err.message);
		console.error('[Organization Upgrade API] エラータイプ:', err.type);
		console.error('[Organization Upgrade API] エラーコード:', err.code);

		// 4xxのHttpErrorはそのまま返す
		if (err?.status && err.status >= 400 && err.status < 500) {
			throw err;
		}

		// クライアントには汎用的なメッセージのみ返す
		const message = 'Checkout Sessionの作成に失敗しました。しばらくしてから再度お試しください。';
		return json({ message }, { status: 500 });
	}
};
