import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';
import { isOrgAdmin } from '$lib/server/orgAuth';
import { ORG_PRICE_IDS as PRICE_IDS, MAX_MEMBERS } from '$lib/server/plans';
import { validateRedirectUrl, ALLOWED_STRIPE_REDIRECT_PATHS } from '$lib/server/validation';
import { logger } from '$lib/server/logger';

export const POST: RequestHandler = async ({ request, locals: { supabase, supabaseAdmin } }) => {
	// レート制限チェックを最初に実行
	const rateLimitResult = await checkRateLimit(request, rateLimiters?.expensive);
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
		const validatedPlanType = planType as keyof typeof PRICE_IDS;

		if (!['month', 'year'].includes(billingInterval)) {
			throw error(400, '無効な請求間隔です。');
		}
		const validatedBillingInterval =
			billingInterval as keyof (typeof PRICE_IDS)[typeof validatedPlanType];

		// Security: Validate redirect URLs to prevent Open Redirect attacks
		const returnValidation = validateRedirectUrl(returnUrl, ALLOWED_STRIPE_REDIRECT_PATHS);
		if (!returnValidation.valid) {
			logger.error(
				'[Organization Upgrade] Invalid returnUrl:',
				returnUrl,
				'Error:',
				returnValidation.error
			);
			throw error(400, `無効なreturnUrlです: ${returnValidation.error}`);
		}

		const cancelValidation = validateRedirectUrl(cancelUrl, ALLOWED_STRIPE_REDIRECT_PATHS);
		if (!cancelValidation.valid) {
			logger.error(
				'[Organization Upgrade] Invalid cancelUrl:',
				cancelUrl,
				'Error:',
				cancelValidation.error
			);
			throw error(400, `無効なcancelUrlです: ${cancelValidation.error}`);
		}

		const sanitizedReturnUrl = returnValidation.sanitizedUrl!;
		const sanitizedCancelUrl = cancelValidation.sanitizedUrl!;

		logger.debug('[Organization Upgrade API] ユーザー:', user.id);
		logger.debug('[Organization Upgrade API] 組織ID:', organizationId);
		logger.debug('[Organization Upgrade API] プラン:', planType, billingInterval);

		// 3. 組織情報を取得
		const { data: organization } = await supabase
			.from('organizations')
			.select('id, name, plan_type, stripe_customer_id')
			.eq('id', organizationId)
			.single();

		if (!organization) {
			throw error(404, '組織が見つかりません。');
		}

		// 4. 組織の管理者権限を確認（orgAuth が退会済みメンバーを除外する）
		if (!(await isOrgAdmin(supabase, organizationId, user.id))) {
			throw error(403, '組織の管理者権限が必要です。');
		}

		// 4b. P0-A: 既にアクティブな契約がある組織で2本目を作らせない（二重課金の防止）。
		//
		// ⚠️ 確認は**必ず service role で**行うこと。subscriptions の SELECT ポリシーは
		// `auth.uid() = user_id`（＝checkout を開始した本人）だけなので、user client で引くと
		// **契約者以外の管理者からは契約が「無い」ように見える**。
		// 以前はこの確認をページの load 側だけで行っており、契約者と別の管理者が操作すると
		// ガードが素通りして2本目のサブスクリプションが作れた。完了すると webhook が
		// 旧サブスクを日割り返金なしで即時解約するため、前払い分がそのまま失効する。
		// 古いタブからの直接 POST でも同じことが起きるので、判定はここ（API）に置く。
		if (!supabaseAdmin) {
			logger.error('[Organization Upgrade API] supabaseAdminが未設定です');
			throw error(500, 'サーバー設定エラーが発生しました。管理者に連絡してください。');
		}

		const { data: existingSubscription, error: existingSubError } = await supabaseAdmin
			.from('subscriptions')
			.select('id, stripe_subscription_id')
			.eq('organization_id', organizationId)
			.in('status', ['active', 'trialing'])
			.maybeSingle();

		if (existingSubError) {
			logger.error('[Organization Upgrade API] 既存契約の確認エラー:', existingSubError);
			throw error(500, '契約状況の確認に失敗しました。しばらくしてから再度お試しください。');
		}

		if (existingSubscription) {
			logger.error(
				'[Organization Upgrade API] P0-A: 既にアクティブな契約があるため中止:',
				organizationId,
				existingSubscription.stripe_subscription_id
			);
			throw error(
				409,
				'この組織には既に有効なご契約があります。プランの変更はプラン変更ページからお願いします。'
			);
		}

		// 5. Price IDを取得
		const priceId = PRICE_IDS[validatedPlanType][validatedBillingInterval];

		if (priceId.includes('placeholder')) {
			// 詳細はログのみに出力（セキュリティ：内部実装の詳細を隠す）
			logger.error('[Organization Upgrade API] CRITICAL: Stripe Price ID not configured!');
			logger.error(
				'[Organization Upgrade API] planType:',
				planType,
				'billingInterval:',
				billingInterval
			);

			// クライアントには汎用的なメッセージ
			throw error(500, 'サービスの設定エラーが発生しました。管理者に連絡してください。');
		}

		// 6. ユーザー情報を取得
		const { data: profile } = await supabase
			.from('profiles')
			.select('full_name')
			.eq('id', user.id)
			.single();

		// 7. Stripe Customerを作成または取得
		let customerId = organization.stripe_customer_id;

		if (!customerId) {
			const customer = await stripe.customers.create({
				email: user.email || undefined,
				name: profile?.full_name || undefined,
				metadata: {
					user_id: user.id,
					organization_id: organizationId,
					organization_name: organization.name,
					is_organization: 'true'
				}
			});

			customerId = customer.id;
			logger.debug('[Organization Upgrade API] 新しいCustomerを作成:', customerId);

			// P3-J: Customer の保存は service role で行い、結果を必ず確認する。
			// user client だと RLS で弾かれた場合に PostgREST が「0行・エラーなし」を返すため、
			// 保存できていないのに成功したように見え、次回また新しい Customer を作って
			// Stripe 上に孤児が増える（3月の障害と同じ失敗の形）。
			const { error: customerSaveError } = await supabaseAdmin
				.from('organizations')
				.update({ stripe_customer_id: customerId })
				.eq('id', organizationId);

			if (customerSaveError) {
				logger.error('[Organization Upgrade API] Customer保存エラー:', customerSaveError);
				throw error(500, '顧客情報の保存に失敗しました。しばらくしてから再度お試しください。');
			}
		}

		// 8. Stripe Checkout Sessionを作成
		// payment_method_types は指定しない（動的支払い方法。Dashboard側で支払い方法を制御）
		const sessionParams: any = {
			customer: customerId,
			mode: 'subscription',
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

		// Security: クーポンはpromotion code（顧客配布用コード）としてのみ受け付ける
		// coupon IDの直接適用は行わない（内部用クーポンの悪用・列挙を防ぐ）
		if (couponCode) {
			if (
				typeof couponCode !== 'string' ||
				couponCode.length > 100 ||
				!/^[a-zA-Z0-9_-]+$/.test(couponCode)
			) {
				throw error(400, '無効なクーポンコードです。');
			}

			const promotionCodes = await stripe.promotionCodes.list({
				code: couponCode,
				active: true,
				limit: 1
			});
			const promotionCode = promotionCodes.data[0];

			if (!promotionCode) {
				throw error(400, '無効なクーポンコードです。');
			}

			sessionParams.discounts = [{ promotion_code: promotionCode.id }];
			// ログには最初の10文字のみ出力（プライバシー保護）
			const maskedCoupon =
				couponCode.length > 10 ? couponCode.substring(0, 10) + '...' : couponCode;
			logger.debug('[Organization Upgrade API] プロモーションコード適用:', maskedCoupon);
		} else {
			// コード未指定時はCheckout画面でのプロモーションコード入力を許可
			sessionParams.allow_promotion_codes = true;
		}

		const session = await stripe.checkout.sessions.create(sessionParams);

		logger.debug('[Organization Upgrade API] Checkout Session作成成功:', session.id);

		// 9. Checkout URLを返す
		return json({ url: session.url });
	} catch (err: any) {
		// 詳細なエラーはログのみに出力（セキュリティ：情報漏洩防止、個人情報保護）
		logger.error('[Organization Upgrade API] エラー:', err.message);
		logger.error('[Organization Upgrade API] エラータイプ:', err.type);
		logger.error('[Organization Upgrade API] エラーコード:', err.code);

		// 4xxのHttpErrorはそのまま返す
		if (err?.status && err.status >= 400 && err.status < 500) {
			throw err;
		}

		// クライアントには汎用的なメッセージのみ返す
		const message = 'Checkout Sessionの作成に失敗しました。しばらくしてから再度お試しください。';
		return json({ message }, { status: 500 });
	}
};
