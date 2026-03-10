import { json, error } from '@sveltejs/kit';
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
		throw error(401, '認証が必要です。');
	}

	try {
		const { returnUrl, organizationId } = await request.json();

		if (!returnUrl || !organizationId) {
			throw error(400, '必須パラメータが不足しています。');
		}

		// Security: Validate redirect URL to prevent Open Redirect attacks
		const returnValidation = validateRedirectUrl(returnUrl, ALLOWED_STRIPE_REDIRECT_PATHS);
		if (!returnValidation.valid) {
			console.error('[Customer Portal] Invalid returnUrl:', returnUrl, 'Error:', returnValidation.error);
			throw error(400, `無効なreturnUrlです: ${returnValidation.error}`);
		}

		const sanitizedReturnUrl = returnValidation.sanitizedUrl!;

		// 2. 組織情報を取得
		const { data: organization } = await supabase
			.from('organizations')
			.select('stripe_customer_id')
			.eq('id', organizationId)
			.single();

		if (!organization || !organization.stripe_customer_id) {
			throw error(404, '組織またはStripe顧客IDが見つかりません。');
		}

		// 3. 組織の管理者権限を確認
		const { data: member } = await supabase
			.from('organization_members')
			.select('role')
			.eq('organization_id', organizationId)
			.eq('user_id', user.id)
			.is('removed_at', null) // T21: 退会済みメンバーを明示的に除外（RLS依存でなくサーバー側で保証）
			.single();

		if (!member || member.role !== 'admin') {
			throw error(403, '組織の管理者権限が必要です。');
		}

		// 4. Stripe Customer Portalセッションを作成
		const session = await stripe.billingPortal.sessions.create({
			customer: organization.stripe_customer_id,
			return_url: sanitizedReturnUrl
		});

		console.log('[Customer Portal API] セッション作成成功:', session.id);

		// 5. Portal URLを返す
		return json({ url: session.url });
	} catch (err: any) {
		console.error('[Customer Portal API] エラー:', err);
		console.error('[Customer Portal API] エラー詳細:', JSON.stringify(err, null, 2));
		// T3: 4xxのHttpErrorはそのまま返す
		if (err?.status && err.status >= 400 && err.status < 500) {
			throw err;
		}
		// T3: Stripe API障害時は error() で統一
		throw error(500, err.message || 'Customer Portalセッションの作成に失敗しました。');
	}
};
