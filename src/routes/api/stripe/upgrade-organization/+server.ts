import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';
import { env } from '$env/dynamic/private';

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
			throw error(500, 'Stripe Price IDが設定されていません。環境変数を確認してください。');
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
			success_url: returnUrl,
			cancel_url: cancelUrl,
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

		// クーポンコードがある場合は追加
		if (couponCode) {
			sessionParams.discounts = [{ coupon: couponCode }];
			console.log('[Organization Upgrade API] クーポンコードを適用:', couponCode);
		}

		const session = await stripe.checkout.sessions.create(sessionParams);

		console.log('[Organization Upgrade API] Checkout Session作成成功:', session.id);

		// 9. Checkout URLを返す
		return json({ url: session.url });
	} catch (err: any) {
		console.error('[Organization Upgrade API] エラー:', err);
		console.error('[Organization Upgrade API] エラー詳細:', JSON.stringify(err, null, 2));
		// 4xxのHttpErrorはそのまま返す
		if (err?.status && err.status >= 400 && err.status < 500) {
			throw err;
		}
		const message = err.message || 'Checkout Sessionの作成に失敗しました。';
		return json({ message }, { status: 500 });
	}
};
