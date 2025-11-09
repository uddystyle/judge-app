import { json, redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';
import { env } from '$env/dynamic/private';

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

		if (!['basic', 'standard', 'premium'].includes(planType)) {
			throw error(400, '無効なプランタイプです。');
		}

		if (!['month', 'year'].includes(billingInterval)) {
			throw error(400, '無効な請求間隔です。');
		}

		console.log('[Organization Checkout API] ユーザー:', user.id);
		console.log('[Organization Checkout API] 組織名:', organizationName);
		console.log('[Organization Checkout API] プラン:', planType, billingInterval);

		// 3. Price IDを取得
		const priceId = PRICE_IDS[planType][billingInterval];

		if (priceId.includes('placeholder')) {
			throw error(
				500,
				'Stripe Price IDが設定されていません。環境変数を確認してください。'
			);
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
				organization_name: organizationName,
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
			success_url: returnUrl,
			cancel_url: cancelUrl,
			metadata: {
				user_id: user.id,
				organization_name: organizationName,
				plan_type: planType,
				max_members: MAX_MEMBERS[planType].toString(),
				billing_interval: billingInterval,
				is_organization: 'true'
			},
			subscription_data: {
				metadata: {
					user_id: user.id,
					organization_name: organizationName,
					plan_type: planType,
					max_members: MAX_MEMBERS[planType].toString(),
					is_organization: 'true'
				}
			}
		};

		// クーポンコードがある場合は追加
		if (couponCode) {
			sessionParams.discounts = [{ coupon: couponCode }];
			console.log('[Organization Checkout API] クーポンコードを適用:', couponCode);
		}

		const session = await stripe.checkout.sessions.create(sessionParams);

		console.log('[Organization Checkout API] Checkout Session作成成功:', session.id);

		// 7. Checkout URLを返す
		return json({ url: session.url });
	} catch (err: any) {
		console.error('[Organization Checkout API] エラー:', err);
		throw error(500, err.message || 'Checkout Sessionの作成に失敗しました。');
	}
};
