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
		const { returnUrl } = await request.json();

		if (!returnUrl) {
			throw error(400, 'returnUrl は必須です。');
		}

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
			return_url: returnUrl
		});

		console.log('[Portal API] Portal Session作成成功:', portalSession.id);

		// 5. Portal URLを返す
		return json({ url: portalSession.url });
	} catch (err: any) {
		console.error('[Portal API] エラー詳細:');
		console.error('  メッセージ:', err.message);
		console.error('  タイプ:', err.type);
		console.error('  コード:', err.code);
		console.error('  ステータスコード:', err.statusCode);
		console.error('  完全なエラー:', JSON.stringify(err, null, 2));
		// 4xxのHttpErrorはそのまま返す
		if (err?.status && err.status >= 400 && err.status < 500) {
			throw err;
		}
		throw error(500, err.message || 'Customer Portal Sessionの作成に失敗しました。');
	}
};
