import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { stripe } from '$lib/server/stripe';

export const load: PageServerLoad = async ({ locals, url }) => {
	const session = await locals.supabase.auth.getSession();

	// 未ログインの場合はログインページへリダイレクト
	if (!session.data.session) {
		throw redirect(303, '/login');
	}

	const user = session.data.session.user;

	// ユーザーのアクティブなサブスクリプション情報を取得
	const { data: subscription } = await locals.supabase
		.from('subscriptions')
		.select('*')
		.eq('user_id', user.id)
		.eq('status', 'active')
		.in('plan_type', ['basic', 'standard', 'premium'])
		.order('created_at', { ascending: false })
		.limit(1)
		.single();

	// ユーザーのプロフィール情報を取得
	const { data: profile } = await locals.supabase
		.from('profiles')
		.select('full_name')
		.eq('id', user.id)
		.single();

	// URLパラメータからクーポンコードを取得
	const couponCode = url.searchParams.get('coupon');
	let validCoupon = null;

	// クーポンコードが指定されている場合、Stripeで有効性を確認
	if (couponCode) {
		try {
			const coupon = await stripe.coupons.retrieve(couponCode);
			if (coupon.valid) {
				validCoupon = {
					id: coupon.id,
					percentOff: coupon.percent_off,
					amountOff: coupon.amount_off,
					currency: coupon.currency
				};
			}
		} catch (error) {
			console.error('Invalid coupon code:', error);
			// クーポンが無効でもエラーにせず、通常料金で表示
		}
	}

	return {
		user,
		profile,
		subscription,
		coupon: validCoupon
	};
};
