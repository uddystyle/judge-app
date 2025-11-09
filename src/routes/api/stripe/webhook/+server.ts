import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';
import {
	STRIPE_WEBHOOK_SECRET,
	SUPABASE_SERVICE_ROLE_KEY,
	STRIPE_PRICE_BASIC_MONTH,
	STRIPE_PRICE_BASIC_YEAR,
	STRIPE_PRICE_STANDARD_MONTH,
	STRIPE_PRICE_STANDARD_YEAR,
	STRIPE_PRICE_PREMIUM_MONTH,
	STRIPE_PRICE_PREMIUM_YEAR
} from '$env/static/private';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

// Service Role Keyを使用してSupabaseクライアントを作成（RLSをバイパス）
const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export const POST: RequestHandler = async ({ request }) => {
	const signature = request.headers.get('stripe-signature');

	if (!signature) {
		console.error('[Webhook] Stripe署名がありません');
		throw error(400, 'Stripe署名がありません。');
	}

	let event;

	try {
		// 1. リクエストボディを取得
		const body = await request.text();

		// 2. Webhook署名を検証
		event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);

		console.log('[Webhook] イベント受信:', event.type, 'ID:', event.id);
	} catch (err: any) {
		console.error('[Webhook] 署名検証エラー:', err.message);
		throw error(400, `Webhook署名検証エラー: ${err.message}`);
	}

	// 3. イベントタイプに応じて処理
	try {
		console.log('[Webhook] 処理開始 - イベントタイプ:', event.type);
		switch (event.type) {
			case 'checkout.session.completed': {
				const session = event.data.object as any;
				console.log('[Webhook] checkout.session.completed - Session ID:', session.id);
				console.log('[Webhook] Metadata:', session.metadata);
				await handleCheckoutCompleted(session);
				break;
			}

			case 'customer.subscription.created': {
				const subscription = event.data.object as any;
				await handleSubscriptionCreated(subscription);
				break;
			}

			case 'customer.subscription.updated': {
				const subscription = event.data.object as any;
				await handleSubscriptionUpdated(subscription);
				break;
			}

			case 'customer.subscription.deleted': {
				const subscription = event.data.object as any;
				await handleSubscriptionDeleted(subscription);
				break;
			}

			case 'invoice.payment_succeeded': {
				const invoice = event.data.object as any;
				await handlePaymentSucceeded(invoice);
				break;
			}

			case 'invoice.payment_failed': {
				const invoice = event.data.object as any;
				await handlePaymentFailed(invoice);
				break;
			}

			default:
				console.log('[Webhook] 未処理のイベントタイプ:', event.type);
		}

		return json({ received: true });
	} catch (err: any) {
		console.error('[Webhook] イベント処理エラー:', err);
		throw error(500, `イベント処理エラー: ${err.message}`);
	}
};

// ============================================================
// イベントハンドラー関数
// ============================================================

/**
 * checkout.session.completed
 * 新規サブスクリプション登録成功時
 */
async function handleCheckoutCompleted(session: any) {
	console.log('[Webhook] Checkout完了:', session.id);

	const userId = session.metadata?.user_id;
	const customerId = session.customer;
	const subscriptionId = session.subscription;
	const isOrganization = session.metadata?.is_organization === 'true';

	if (!userId || !customerId) {
		console.error('[Webhook] user_idまたはcustomer_idが見つかりません');
		return;
	}

	// Stripe Subscriptionの詳細を取得
	const subscription = await stripe.subscriptions.retrieve(subscriptionId);
	const priceId = subscription.items.data[0].price.id;
	const planType = getPlanTypeFromPrice(priceId);
	const billingInterval = subscription.items.data[0].price.recurring?.interval || 'month';

	console.log('[Webhook] Price ID:', priceId, '→ プランタイプ:', planType, '課金間隔:', billingInterval);

	// 組織向けサブスクリプションの場合
	if (isOrganization) {
		await handleOrganizationCheckout(session, subscription, planType, billingInterval);
	} else {
		// 個人向けサブスクリプション
		const { error: upsertError } = await supabaseAdmin
			.from('subscriptions')
			.upsert(
				{
					user_id: userId,
					stripe_customer_id: customerId,
					stripe_subscription_id: subscriptionId,
					plan_type: planType,
					billing_interval: billingInterval,
					status: subscription.status,
					current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
					current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
					cancel_at_period_end: subscription.cancel_at_period_end
				},
				{ onConflict: 'user_id' }
			);

		if (upsertError) {
			console.error('[Webhook] subscriptions更新エラー:', upsertError);
		} else {
			console.log('[Webhook] subscriptions更新成功:', userId, planType);
		}
	}
}

/**
 * 組織向けCheckout処理
 */
async function handleOrganizationCheckout(
	session: any,
	subscription: any,
	planType: string,
	billingInterval: string
) {
	const userId = session.metadata?.user_id;
	const organizationId = session.metadata?.organization_id;
	const organizationName = session.metadata?.organization_name;
	const maxMembers = parseInt(session.metadata?.max_members || '10');
	const customerId = session.customer;
	const subscriptionId = subscription.id;
	const isUpgrade = session.metadata?.is_upgrade === 'true';

	if (!organizationName) {
		console.error('[Webhook] organization_nameが見つかりません');
		return;
	}

	try {
		// アップグレードの場合
		if (isUpgrade && organizationId) {
			console.log('[Webhook] 組織アップグレード開始:', organizationId);
			console.log('[Webhook] プランタイプ:', planType, '最大メンバー:', maxMembers);

			// 1. 組織を更新
			const { error: orgError } = await supabaseAdmin
				.from('organizations')
				.update({
					plan_type: planType,
					max_members: maxMembers,
					stripe_subscription_id: subscriptionId,
					stripe_customer_id: customerId
				})
				.eq('id', organizationId);

			if (orgError) {
				console.error('[Webhook] 組織更新エラー:', orgError);
				throw orgError;
			}

			console.log('[Webhook] 組織更新成功:', organizationId, 'plan_type:', planType);

			// 2. subscriptionsテーブルに情報を保存（upsertを使用）
			const { error: subError } = await supabaseAdmin
				.from('subscriptions')
				.upsert(
					{
						user_id: userId,
						organization_id: organizationId,
						stripe_customer_id: customerId,
						stripe_subscription_id: subscriptionId,
						plan_type: planType,
						billing_interval: billingInterval,
						status: subscription.status,
						current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
						current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
						cancel_at_period_end: subscription.cancel_at_period_end
					},
					{
						onConflict: 'stripe_subscription_id',
						ignoreDuplicates: false
					}
				);

			if (subError) {
				console.error('[Webhook] subscription作成エラー:', subError);
				throw subError;
			}

			console.log('[Webhook] 組織アップグレード完了:', organizationId);
		}
		// 新規作成の場合
		else {
			console.log('[Webhook] 組織作成開始:', organizationName);

			// 1. 組織を作成
			const { data: organization, error: orgError } = await supabaseAdmin
				.from('organizations')
				.insert({
					name: organizationName,
					plan_type: planType,
					max_members: maxMembers,
					stripe_customer_id: customerId,
					stripe_subscription_id: subscriptionId
				})
				.select()
				.single();

			if (orgError) {
				console.error('[Webhook] 組織作成エラー:', orgError);
				throw orgError;
			}

			console.log('[Webhook] 組織作成成功:', organization.id);

			// 2. 作成者を管理者としてメンバーに追加
			const { error: memberError } = await supabaseAdmin.from('organization_members').insert({
				organization_id: organization.id,
				user_id: userId,
				role: 'admin'
			});

			if (memberError) {
				console.error('[Webhook] メンバー追加エラー:', memberError);
				throw memberError;
			}

			console.log('[Webhook] 管理者メンバー追加成功:', userId);

			// 3. subscriptionsテーブルに組織情報を保存
			const { error: subError } = await supabaseAdmin.from('subscriptions').insert({
				user_id: userId,
				organization_id: organization.id,
				stripe_customer_id: customerId,
				stripe_subscription_id: subscriptionId,
				plan_type: planType,
				billing_interval: billingInterval,
				status: subscription.status,
				current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
				current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
				cancel_at_period_end: subscription.cancel_at_period_end
			});

			if (subError) {
				console.error('[Webhook] subscription作成エラー:', subError);
				throw subError;
			}

			console.log('[Webhook] 組織向けサブスクリプション作成完了:', organization.id);
		}
	} catch (error) {
		console.error('[Webhook] 組織処理でエラー:', error);
		throw error;
	}
}

/**
 * customer.subscription.created
 * サブスクリプション作成時（checkoutの後に来る）
 */
async function handleSubscriptionCreated(subscription: any) {
	console.log('[Webhook] Subscription作成:', subscription.id);

	const customerId = subscription.customer;

	// Customer IDからuser_idを取得
	const { data: subData } = await supabaseAdmin
		.from('subscriptions')
		.select('user_id')
		.eq('stripe_customer_id', customerId)
		.single();

	if (!subData) {
		console.error('[Webhook] user_idが見つかりません (Customer ID:', customerId, ')');
		return;
	}

	const planType = getPlanTypeFromPrice(subscription.items.data[0].price.id);
	const billingInterval = subscription.items.data[0].price.recurring?.interval || 'month';

	// subscriptionsテーブルを更新
	const { error: updateError } = await supabaseAdmin
		.from('subscriptions')
		.update({
			stripe_subscription_id: subscription.id,
			plan_type: planType,
			billing_interval: billingInterval,
			status: subscription.status,
			current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
			current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
			cancel_at_period_end: subscription.cancel_at_period_end
		})
		.eq('user_id', subData.user_id);

	if (updateError) {
		console.error('[Webhook] subscriptions更新エラー:', updateError);
	} else {
		console.log('[Webhook] subscriptions更新成功:', subData.user_id, planType);
	}
}

/**
 * customer.subscription.updated
 * プラン変更時
 */
async function handleSubscriptionUpdated(subscription: any) {
	console.log('[Webhook] Subscription更新:', subscription.id);

	const planType = getPlanTypeFromPrice(subscription.items.data[0].price.id);
	const billingInterval = subscription.items.data[0].price.recurring?.interval || 'month';

	// subscriptionsテーブルを更新
	const { error: updateError } = await supabaseAdmin
		.from('subscriptions')
		.update({
			plan_type: planType,
			billing_interval: billingInterval,
			status: subscription.status,
			current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
			current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
			cancel_at_period_end: subscription.cancel_at_period_end
		})
		.eq('stripe_subscription_id', subscription.id);

	if (updateError) {
		console.error('[Webhook] subscriptions更新エラー:', updateError);
	} else {
		console.log('[Webhook] subscriptions更新成功:', subscription.id, planType);
	}
}

/**
 * customer.subscription.deleted
 * サブスクリプションキャンセル時
 */
async function handleSubscriptionDeleted(subscription: any) {
	console.log('[Webhook] Subscriptionキャンセル:', subscription.id);

	// subscriptionsテーブルを更新（フリープランに降格）
	const { error: updateError } = await supabaseAdmin
		.from('subscriptions')
		.update({
			plan_type: 'free',
			status: 'canceled',
			stripe_subscription_id: null
		})
		.eq('stripe_subscription_id', subscription.id);

	if (updateError) {
		console.error('[Webhook] subscriptions更新エラー:', updateError);
	} else {
		console.log('[Webhook] subscriptionsをフリープランに降格:', subscription.id);
	}
}

/**
 * invoice.payment_succeeded
 * 支払い成功時（更新時）
 */
async function handlePaymentSucceeded(invoice: any) {
	console.log('[Webhook] 支払い成功:', invoice.id);

	const subscriptionId = invoice.subscription;

	if (!subscriptionId) {
		console.log('[Webhook] サブスクリプションIDがありません（単発支払い？）');
		return;
	}

	// Stripe Subscriptionの詳細を取得
	const subscription = await stripe.subscriptions.retrieve(subscriptionId);

	// subscriptionsテーブルを更新
	const { error: updateError } = await supabaseAdmin
		.from('subscriptions')
		.update({
			status: 'active',
			current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
			current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
		})
		.eq('stripe_subscription_id', subscriptionId);

	if (updateError) {
		console.error('[Webhook] subscriptions更新エラー:', updateError);
	} else {
		console.log('[Webhook] subscriptions更新成功 (支払い成功):', subscriptionId);
	}
}

/**
 * invoice.payment_failed
 * 支払い失敗時
 */
async function handlePaymentFailed(invoice: any) {
	console.log('[Webhook] 支払い失敗:', invoice.id);

	const subscriptionId = invoice.subscription;

	if (!subscriptionId) {
		console.log('[Webhook] サブスクリプションIDがありません');
		return;
	}

	// subscriptionsテーブルを更新
	const { error: updateError } = await supabaseAdmin
		.from('subscriptions')
		.update({
			status: 'past_due'
		})
		.eq('stripe_subscription_id', subscriptionId);

	if (updateError) {
		console.error('[Webhook] subscriptions更新エラー:', updateError);
	} else {
		console.log('[Webhook] subscriptions更新成功 (支払い失敗):', subscriptionId);
	}

	// TODO: ユーザーにメール通知を送る
}

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * Price IDからプランタイプを判定
 */
function getPlanTypeFromPrice(
	priceId: string
): 'free' | 'standard' | 'pro' | 'basic' | 'premium' {
	// 個人向けプランのPrice IDマッピング
	const STANDARD_PRICES = [
		'price_1SPHtjIsuW568CJsdqnUsm9d', // 月額
		'price_1SPHurIsuW568CJsFfJ6kwYV' // 年額
	];

	const PRO_PRICES = [
		'price_1SPHvrIsuW568CJsBsRymAvZ', // 月額
		'price_1SPHwCIsuW568CJsuuhrug0G' // 年額
	];

	// 組織向けプランのPrice IDマッピング（環境変数から取得）
	const BASIC_PRICES = [STRIPE_PRICE_BASIC_MONTH, STRIPE_PRICE_BASIC_YEAR].filter(Boolean);

	const ORG_STANDARD_PRICES = [STRIPE_PRICE_STANDARD_MONTH, STRIPE_PRICE_STANDARD_YEAR].filter(
		Boolean
	);

	const PREMIUM_PRICES = [STRIPE_PRICE_PREMIUM_MONTH, STRIPE_PRICE_PREMIUM_YEAR].filter(Boolean);

	// 組織向けプランのチェック（環境変数が設定されている場合）
	if (BASIC_PRICES.includes(priceId)) {
		return 'basic';
	} else if (ORG_STANDARD_PRICES.includes(priceId)) {
		return 'standard';
	} else if (PREMIUM_PRICES.includes(priceId)) {
		return 'premium';
	}
	// 個人向けプランのチェック
	else if (STANDARD_PRICES.includes(priceId)) {
		return 'standard';
	} else if (PRO_PRICES.includes(priceId)) {
		return 'pro';
	} else {
		console.warn('[Webhook] 不明なPrice ID:', priceId, '- デフォルトでfreeを返します');
		return 'free';
	}
}
