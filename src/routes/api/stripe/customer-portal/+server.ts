import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';

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
		const { returnUrl, organizationId } = await request.json();

		if (!returnUrl || !organizationId) {
			throw error(400, '必須パラメータが不足しています。');
		}

		// 2. 組織情報を取得
		const { data: organization } = await supabase
			.from('organizations')
			.select('stripe_customer_id')
			.eq('id', organizationId)
			.single();

		if (!organization || !organization.stripe_customer_id) {
			throw error(404, '組織またはStripe顧客IDが見つかりません。');
		}

		// 3. Stripe Customer Portalセッションを作成
		const session = await stripe.billingPortal.sessions.create({
			customer: organization.stripe_customer_id,
			return_url: returnUrl
		});

		console.log('[Customer Portal API] セッション作成成功:', session.id);

		// 4. Portal URLを返す
		return json({ url: session.url });
	} catch (err: any) {
		console.error('[Customer Portal API] エラー:', err);
		console.error('[Customer Portal API] エラー詳細:', JSON.stringify(err, null, 2));
		const message = err.message || 'Customer Portalセッションの作成に失敗しました。';
		return json({ message }, { status: 500 });
	}
};
