import { json, redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';

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
		const { priceId, successUrl, cancelUrl } = await request.json();

		if (!priceId || !successUrl || !cancelUrl) {
			throw error(400, 'priceId, successUrl, cancelUrl は必須です。');
		}

		console.log('[Checkout API] ユーザー:', user.id, 'プライスID:', priceId);

		// 3. 既存のサブスクリプション情報を確認
		const { data: existingSub } = await supabase
			.from('subscriptions')
			.select('stripe_customer_id, plan_type')
			.eq('user_id', user.id)
			.single();

		let customerId: string;

		if (existingSub?.stripe_customer_id) {
			// 既存のCustomer IDを使用
			customerId = existingSub.stripe_customer_id;
			console.log('[Checkout API] 既存のCustomer IDを使用:', customerId);
		} else {
			// 4. 新しいStripe Customerを作成
			const { data: profile } = await supabase
				.from('profiles')
				.select('full_name, email')
				.eq('id', user.id)
				.single();

			const customer = await stripe.customers.create({
				email: user.email || profile?.email || undefined,
				name: profile?.full_name || undefined,
				metadata: {
					user_id: user.id
				}
			});

			customerId = customer.id;
			console.log('[Checkout API] 新しいCustomerを作成:', customerId);

			// subscriptionsテーブルに保存（フリープランとして）
			await supabase.from('subscriptions').insert({
				user_id: user.id,
				stripe_customer_id: customerId,
				plan_type: 'free',
				billing_interval: 'month',
				status: 'active'
			});
		}

		// 5. Stripe Checkout Sessionを作成
		const session = await stripe.checkout.sessions.create({
			customer: customerId,
			mode: 'subscription',
			payment_method_types: ['card'],
			line_items: [
				{
					price: priceId,
					quantity: 1
				}
			],
			success_url: successUrl,
			cancel_url: cancelUrl,
			metadata: {
				user_id: user.id
			},
			// 既存のサブスクリプションがある場合は更新
			...(existingSub?.stripe_customer_id && {
				subscription_data: {
					metadata: {
						user_id: user.id
					}
				}
			})
		});

		console.log('[Checkout API] Checkout Session作成成功:', session.id);

		// 6. Checkout URLを返す
		return json({ url: session.url });
	} catch (err: any) {
		console.error('[Checkout API] エラー:', err);
		throw error(500, err.message || 'Checkout Sessionの作成に失敗しました。');
	}
};
