import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { stripe } from '$lib/server/stripe';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals, url }) => {
	// getUser() で JWT を Supabase Auth サーバー側で検証する
	// getSession() はクッキーをパースするだけで検証を行わないため、認可判定には使わない
	const {
		data: { user },
		error: userError
	} = await locals.supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// ユーザーのアクティブなサブスクリプション情報を取得
	// 既に組織に紐づいているサブスクリプションは除外
	const { data: subscription } = await locals.supabase
		.from('subscriptions')
		.select('*')
		.eq('user_id', user.id)
		.eq('status', 'active')
		.in('plan_type', ['basic', 'standard', 'premium'])
		.is('organization_id', null)
		.order('created_at', { ascending: false })
		.limit(1)
		.single();

	// ユーザーのプロフィール情報を取得
	const { data: profile } = await locals.supabase
		.from('profiles')
		.select('full_name')
		.eq('id', user.id)
		.single();

	// 組織所属チェック（軽量クエリ - カウントのみ）
	const { count } = await locals.supabase
		.from('organization_members')
		.select('*', { count: 'exact', head: true })
		.eq('user_id', user.id)
		.is('removed_at', null);

	const hasOrganization = (count || 0) > 0;

	// URLパラメータからクーポンコードを取得
	const couponCode = url.searchParams.get('coupon');
	let validCoupon = null;

	// Security: クーポンはpromotion code（顧客配布用コード）としてのみ解決する
	// coupon IDの直接参照は行わない（内部用クーポンの悪用・列挙を防ぐ）
	if (couponCode && /^[a-zA-Z0-9_-]{1,100}$/.test(couponCode)) {
		try {
			const promotionCodes = await stripe.promotionCodes.list({
				code: couponCode,
				active: true,
				limit: 1
			});
			const promotionCode = promotionCodes.data[0];
			if (promotionCode) {
				// pin中のAPIバージョン（acacia）はトップレベル coupon、新形状は promotion.coupon。
				// SDK型とAPIバージョンの不一致に備え両形状を防御的に読む（webhookのgetSubscriptionPeriodと同方針）
				const rawCoupon =
					(promotionCode as any).coupon ?? (promotionCode as any).promotion?.coupon;
				const coupon = rawCoupon && typeof rawCoupon === 'object' ? rawCoupon : null;
				validCoupon = {
					// checkout側で再解決するため、入力コード（promotion code文字列）をそのまま返す
					id: couponCode,
					percentOff: coupon?.percent_off ?? null,
					amountOff: coupon?.amount_off ?? null,
					currency: coupon?.currency ?? null
				};
			}
		} catch (error) {
			logger.error('Invalid promotion code:', error);
			// クーポンが無効でもエラーにせず、通常料金で表示
		}
	}

	return {
		user,
		profile,
		subscription,
		coupon: validCoupon,
		hasOrganization
	};
};
