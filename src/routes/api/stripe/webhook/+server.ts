import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/server/stripe';
import {
	STRIPE_WEBHOOK_SECRET,
	STRIPE_SECRET_KEY,
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

// ============================================================
// カスタムエラークラス
// ============================================================

/**
 * リトライ可能なエラー（500番台を返す）
 * - データベース接続エラー
 * - Stripe API一時的障害
 * - その他のサーバー側の一時的な問題
 */
class RetryableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RetryableError';
	}
}

/**
 * リトライ不要なエラー（400番台を返す）
 * - データ不正
 * - 必須データが見つからない
 * - ビジネスロジックの検証エラー
 */
class NonRetryableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NonRetryableError';
	}
}

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

	// T14: livemode検証 - 環境とイベントのlivemode不一致を検出
	// event.livemodeが明示的に存在する場合のみチェック（テストモック互換性のため）
	if (event.livemode !== undefined) {
		const expectedLivemode = STRIPE_SECRET_KEY.startsWith('sk_live_');
		const eventLivemode = event.livemode;

		if (expectedLivemode !== eventLivemode) {
			const envType = expectedLivemode ? '本番' : 'テスト';
			const eventType = eventLivemode ? '本番' : 'テスト';
			console.warn(
				`[Webhook] T14: livemode不一致を検出 - 環境: ${envType}, イベント: ${eventType}, event.id: ${event.id}`
			);
			console.warn('[Webhook] T14: 不一致イベントはDB更新をスキップします');
			// 不一致イベントは200で応答してStripeに再送させない（ログのみ記録）
			return json({ received: true, skipped: true, reason: 'livemode_mismatch' });
		}
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

		// エラーの種類に応じて適切なHTTPステータスコードを返す
		if (err instanceof NonRetryableError) {
			// 400番台: リトライ不要なエラー（データ不正、必須データなしなど）
			console.error('[Webhook] リトライ不要なエラー:', err.message);
			throw error(400, `リトライ不要なエラー: ${err.message}`);
		} else if (err instanceof RetryableError) {
			// 500番台: リトライすべきエラー（DB障害、Stripe API障害など）
			console.error('[Webhook] リトライ可能なエラー:', err.message);
			throw error(500, `リトライ可能なエラー: ${err.message}`);
		} else {
			// デフォルト: 不明なエラーは500を返す（安全側に倒す）
			console.error('[Webhook] 不明なエラー:', err.message);
			throw error(500, `イベント処理エラー: ${err.message}`);
		}
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
	const isOrganizationStr = session.metadata?.is_organization;

	// 必須データの検証（リトライ不要なエラー）
	if (!userId || !customerId) {
		const errMsg = 'user_idまたはcustomer_idが見つかりません';
		console.error('[Webhook]', errMsg);
		throw new NonRetryableError(errMsg);
	}

	if (!subscriptionId) {
		const errMsg = 'Subscription IDが見つかりません';
		console.error('[Webhook]', errMsg);
		throw new NonRetryableError(errMsg);
	}

	// is_organization の検証（T1）
	if (!isOrganizationStr || (isOrganizationStr !== 'true' && isOrganizationStr !== 'false')) {
		const errMsg = 'is_organizationは"true"または"false"である必要があります';
		console.error('[Webhook]', errMsg, '値:', isOrganizationStr);
		throw new NonRetryableError(errMsg);
	}

	const isOrganization = isOrganizationStr === 'true';

	// Stripe Subscriptionの詳細を取得（リトライ可能なエラー）
	let subscription;
	try {
		subscription = await stripe.subscriptions.retrieve(subscriptionId);
	} catch (err: any) {
		console.error('[Webhook] Stripe API エラー:', err.message);
		console.error('[Webhook] Subscription ID:', subscriptionId);
		throw new RetryableError(`Stripe API呼び出しエラー: ${err.message}`);
	}

	// 組織向けサブスクリプションの場合（metadata検証を先に行う）
	if (isOrganization) {
		await handleOrganizationCheckout(session, subscription);
	} else {
		// 個人向けサブスクリプション
		// T10: Stripe Subscriptionレスポンスの異常データ検証
		if (!subscription.items?.data || subscription.items.data.length === 0) {
			const errMsg = 'subscription.items.dataが空です';
			console.error('[Webhook]', errMsg);
			throw new RetryableError(errMsg);
		}

		const item = subscription.items.data[0];
		if (!item.price || !item.price.id) {
			const errMsg = 'subscription.items.data[0].priceが見つかりません';
			console.error('[Webhook]', errMsg);
			throw new RetryableError(errMsg);
		}

		const priceId = item.price.id;
		const planType = getPlanTypeFromPrice(priceId);
		const billingInterval = item.price.recurring?.interval || 'month';

		console.log('[Webhook] Price ID:', priceId, '→ プランタイプ:', planType, '課金間隔:', billingInterval);

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
			throw new RetryableError(`データベース更新エラー: ${upsertError.message}`);
		}

		console.log('[Webhook] subscriptions更新成功:', userId, planType);
	}
}

/**
 * 組織向けCheckout処理
 */
async function handleOrganizationCheckout(session: any, subscription: any) {
	const userId = session.metadata?.user_id;
	const organizationId = session.metadata?.organization_id;
	const organizationName = session.metadata?.organization_name;
	const maxMembersStr = session.metadata?.max_members || '10';
	const customerId = session.customer;
	const subscriptionId = subscription.id;
	const isUpgradeStr = session.metadata?.is_upgrade;

	// 必須データの検証（リトライ不要なエラー）
	if (!organizationName) {
		const errMsg = 'organization_nameが見つかりません';
		console.error('[Webhook]', errMsg);
		throw new NonRetryableError(errMsg);
	}

	// max_members の検証（T1）
	const maxMembers = parseInt(maxMembersStr);
	if (isNaN(maxMembers) || maxMembers <= 0) {
		const errMsg = 'max_membersは正の整数である必要があります';
		console.error('[Webhook]', errMsg, '値:', maxMembersStr);
		throw new NonRetryableError(errMsg);
	}

	// is_upgrade の検証（T1）
	if (isUpgradeStr && isUpgradeStr !== 'true' && isUpgradeStr !== 'false') {
		const errMsg = 'is_upgradeは"true"または"false"である必要があります';
		console.error('[Webhook]', errMsg, '値:', isUpgradeStr);
		throw new NonRetryableError(errMsg);
	}

	const isUpgrade = isUpgradeStr === 'true';

	// T9: is_upgrade=trueの場合はorganization_idが必須
	if (isUpgrade && !organizationId) {
		const errMsg = 'is_upgrade=trueの場合はorganization_idが必須です';
		console.error('[Webhook]', errMsg);
		throw new NonRetryableError(errMsg);
	}

	// metadata検証後に price/plan情報を取得（T2）
	// T10: Stripe Subscriptionレスポンスの異常データ検証
	if (!subscription.items?.data || subscription.items.data.length === 0) {
		const errMsg = 'subscription.items.dataが空です';
		console.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}

	const item = subscription.items.data[0];
	if (!item.price || !item.price.id) {
		const errMsg = 'subscription.items.data[0].priceが見つかりません';
		console.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}

	const priceId = item.price.id;
	const planType = getPlanTypeFromPrice(priceId);
	const billingInterval = item.price.recurring?.interval || 'month';

	console.log('[Webhook] Price ID:', priceId, '→ プランタイプ:', planType, '課金間隔:', billingInterval);

	try {
		// アップグレードの場合
		if (isUpgrade && organizationId) {
			console.log('[Webhook] 組織アップグレード開始:', organizationId);
			console.log('[Webhook] プランタイプ:', planType, '最大メンバー:', maxMembers);

			// 1. 古いサブスクリプションのorganization_idをクリア（UNIQUE制約違反を回避）
			// 新しいサブスクリプション以外のアクティブなサブスクリプションをクリア
			const { error: oldSubClearError } = await supabaseAdmin
				.from('subscriptions')
				.update({
					organization_id: null,
					status: 'canceled'
				})
				.eq('organization_id', organizationId)
				.in('status', ['active', 'trialing'])
				.neq('stripe_subscription_id', subscriptionId);

			if (oldSubClearError) {
				console.error('[Webhook] 古いサブスクリプションのクリアエラー:', oldSubClearError);
				throw new RetryableError(`古いサブスクリプションのクリアエラー: ${oldSubClearError.message}`);
			}

			console.log('[Webhook] 古いサブスクリプションをクリアしました');

			// 2. 組織を更新
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
				throw new RetryableError(`組織更新エラー: ${orgError.message}`);
			}

			console.log('[Webhook] 組織更新成功:', organizationId, 'plan_type:', planType);

			// 3. 新しいサブスクリプションをUPSERT（UNIQUE制約違反なし）
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
				throw new RetryableError(`subscription作成エラー: ${subError.message}`);
			}

			console.log('[Webhook] 組織アップグレード完了:', organizationId);
		}
		// 新規作成の場合
		else {
			console.log('[Webhook] 組織作成開始:', organizationName);

			// 1. 組織を作成または取得（べき等性確保のためUPSERT使用）
			// stripe_subscription_idがユニーク制約のため、Webhook再送時は既存組織を取得
			const { data: organization, error: orgError } = await supabaseAdmin
				.from('organizations')
				.upsert(
					{
						name: organizationName,
						plan_type: planType,
						max_members: maxMembers,
						stripe_customer_id: customerId,
						stripe_subscription_id: subscriptionId
					},
					{
						onConflict: 'stripe_subscription_id',
						ignoreDuplicates: false
					}
				)
				.select()
				.single();

			if (orgError) {
				console.error('[Webhook] 組織作成/取得エラー:', orgError);
				throw new RetryableError(`組織作成/取得エラー: ${orgError.message}`);
			}

			console.log('[Webhook] 組織作成/取得成功:', organization.id);

			// 2. 作成者を管理者としてメンバーに追加（べき等性確保のためUPSERT使用）
			// organization_id + user_idがユニーク制約のため、Webhook再送時は既存メンバーを更新
			const { error: memberError } = await supabaseAdmin
				.from('organization_members')
				.upsert(
					{
						organization_id: organization.id,
						user_id: userId,
						role: 'admin'
					},
					{
						onConflict: 'organization_id,user_id',
						ignoreDuplicates: false
					}
				);

			if (memberError) {
				console.error('[Webhook] メンバー追加エラー:', memberError);
				console.error('[Webhook] エラー詳細:', JSON.stringify(memberError, null, 2));
				// メンバー追加失敗は致命的ではないので、警告のみでエラーを投げない
				console.warn('[Webhook] メンバー追加に失敗しましたが処理を継続します');
			} else {
				console.log('[Webhook] 管理者メンバー追加成功:', userId);
			}

			// 3. subscriptionsテーブルに組織情報を保存（べき等性確保のためUPSERT使用）
			// stripe_subscription_idがユニーク制約のため、Webhook再送時は既存サブスクリプションを更新
			const { error: subError } = await supabaseAdmin
				.from('subscriptions')
				.upsert(
					{
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
					},
					{
						onConflict: 'stripe_subscription_id',
						ignoreDuplicates: false
					}
				);

			if (subError) {
				console.error('[Webhook] subscription作成/更新エラー:', subError);
				console.error('[Webhook] エラー詳細:', JSON.stringify(subError, null, 2));
				throw new RetryableError(`subscription作成/更新エラー: ${subError.message}`);
			}

			console.log('[Webhook] 組織向けサブスクリプション作成/更新完了:', organization.id);
		}
	} catch (err: any) {
		console.error('[Webhook] 組織処理でエラー:', err);
		// 既にカスタムエラーの場合はそのまま再throw
		if (err instanceof NonRetryableError || err instanceof RetryableError) {
			throw err;
		}
		// それ以外はRetryableErrorとして扱う
		throw new RetryableError(`組織処理エラー: ${err.message}`);
	}
}

/**
 * customer.subscription.created
 * サブスクリプション作成時（checkoutの後に来る）
 */
async function handleSubscriptionCreated(subscription: any) {
	console.log('[Webhook] Subscription作成:', subscription.id);

	const customerId = subscription.customer;

	// Customer IDからuser_idとorganization_idを取得
	const { data: subData, error: fetchError } = await supabaseAdmin
		.from('subscriptions')
		.select('user_id, organization_id')
		.eq('stripe_customer_id', customerId)
		.single();

	if (fetchError || !subData) {
		const errMsg = `Customer ID: ${customerId} のsubscriptionが見つかりません`;
		console.error('[Webhook] subscription取得エラー:', fetchError);
		console.error('[Webhook]', errMsg);
		throw new NonRetryableError(errMsg);
	}

	// T10/T11: Stripe Subscriptionレスポンスの異常データ検証
	if (!subscription.items?.data || subscription.items.data.length === 0) {
		const errMsg = 'subscription.items.dataが空です';
		console.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}

	const item = subscription.items.data[0];
	if (!item.price || !item.price.id) {
		const errMsg = 'subscription.items.data[0].priceが見つかりません';
		console.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}

	// T10/T11: getPlanTypeFromPriceは未知price IDでRetryableErrorを投げる（T2で実装済み）
	const planType = getPlanTypeFromPrice(item.price.id);
	const billingInterval = item.price.recurring?.interval || 'month';

	// 1. subscriptionsテーブルを更新
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
		.eq('stripe_subscription_id', subscription.id);

	if (updateError) {
		console.error('[Webhook] subscriptions更新エラー:', updateError);
		throw new RetryableError(`subscriptions更新エラー: ${updateError.message}`);
	}

	console.log('[Webhook] subscriptions更新成功:', subData.user_id, planType);

	// 2. organizationIdが存在する場合のみorganizationsテーブルを更新
	if (subData.organization_id) {
		// plan_limitsから新しいプランのmax_membersを取得
		const { data: planLimits, error: planLimitsError } = await supabaseAdmin
			.from('plan_limits')
			.select('max_organization_members')
			.eq('plan_type', planType)
			.single();

		if (planLimitsError) {
			const errMsg = `プランタイプ: ${planType} のplan_limitsが見つかりません`;
			console.error('[Webhook] plan_limits取得エラー:', planLimitsError);
			console.error('[Webhook]', errMsg);
			throw new NonRetryableError(errMsg);
		}

		const maxMembers = planLimits.max_organization_members;

		// organizationsテーブルを更新
		const { error: orgUpdateError } = await supabaseAdmin
			.from('organizations')
			.update({
				plan_type: planType,
				max_members: maxMembers
			})
			.eq('id', subData.organization_id);

		if (orgUpdateError) {
			console.error('[Webhook] organizations更新エラー:', orgUpdateError);
			console.error('[Webhook] Organization ID:', subData.organization_id);
			throw new RetryableError(`organizations更新エラー: ${orgUpdateError.message}`);
		}

		console.log(
			'[Webhook] organizations更新成功:',
			subData.organization_id,
			'plan_type:',
			planType,
			'max_members:',
			maxMembers
		);
	} else {
		console.log(
			'[Webhook] organization_idが存在しないため、organizationsテーブルは更新しません（個人向けサブスクリプション）'
		);
	}
}

/**
 * customer.subscription.updated
 * プラン変更時
 */
async function handleSubscriptionUpdated(subscription: any) {
	console.log('[Webhook] Subscription更新:', subscription.id);

	// T11: Stripe Subscriptionレスポンスの異常データ検証（T10と同様）
	if (!subscription.items?.data || subscription.items.data.length === 0) {
		const errMsg = 'subscription.items.dataが空です';
		console.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}

	const item = subscription.items.data[0];
	if (!item.price || !item.price.id) {
		const errMsg = 'subscription.items.data[0].priceが見つかりません';
		console.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}

	// T11: getPlanTypeFromPriceは未知price IDでRetryableErrorを投げる（T2で実装済み）
	const planType = getPlanTypeFromPrice(item.price.id);
	const billingInterval = item.price.recurring?.interval || 'month';

	// T13: subscriptionsテーブルから組織IDと現在の期間を取得
	const { data: subscriptionData, error: fetchError } = await supabaseAdmin
		.from('subscriptions')
		.select('organization_id, current_period_end, status, cancel_at_period_end, plan_type, billing_interval')
		.eq('stripe_subscription_id', subscription.id)
		.single();

	if (fetchError || !subscriptionData) {
		const errMsg = `Subscription ID: ${subscription.id} が見つかりません`;
		console.error('[Webhook] subscription取得エラー:', fetchError);
		console.error('[Webhook]', errMsg);
		throw new NonRetryableError(errMsg);
	}

	const organizationId = subscriptionData.organization_id;

	// T13: リプレイ防御 - イベントの方が古い場合はスキップ
	// 同一期間内の状態変化（プラン変更、status変化など）は許可するため、< を使用
	const eventPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
	if (subscriptionData.current_period_end) {
		const currentPeriodEnd = new Date(subscriptionData.current_period_end).getTime();
		const eventPeriodEndTime = new Date(eventPeriodEnd).getTime();

		if (eventPeriodEndTime < currentPeriodEnd) {
			console.log('[Webhook] 古いイベントを検出 - 更新をスキップ');
			console.log('[Webhook] 現在のcurrent_period_end:', subscriptionData.current_period_end);
			console.log('[Webhook] イベントのcurrent_period_end:', eventPeriodEnd);
			return; // T13: 古いイベントはスキップ
		}

		// T13最適化: 同一period_endかつ同一内容の場合はDB更新を省略
		if (
			eventPeriodEndTime === currentPeriodEnd &&
			subscriptionData.status === subscription.status &&
			subscriptionData.cancel_at_period_end === subscription.cancel_at_period_end &&
			subscriptionData.plan_type === planType &&
			subscriptionData.billing_interval === billingInterval
		) {
			console.log('[Webhook] 同一内容の重複イベントを検出 - DB更新を省略');
			return;
		}
	}

	// 2. subscriptionsテーブルを更新
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
		throw new RetryableError(`subscriptions更新エラー: ${updateError.message}`);
	}

	console.log('[Webhook] subscriptions更新成功:', subscription.id, planType);

	// 3. organizationIdが存在する場合のみorganizationsテーブルを更新
	if (organizationId) {
		// plan_limitsから新しいプランのmax_membersを取得
		const { data: planLimits, error: planLimitsError } = await supabaseAdmin
			.from('plan_limits')
			.select('max_organization_members')
			.eq('plan_type', planType)
			.single();

		if (planLimitsError) {
			const errMsg = `プランタイプ: ${planType} のplan_limitsが見つかりません`;
			console.error('[Webhook] plan_limits取得エラー:', planLimitsError);
			console.error('[Webhook]', errMsg);
			throw new NonRetryableError(errMsg);
		}

		const maxMembers = planLimits.max_organization_members;

		// organizationsテーブルを更新
		const { error: orgUpdateError } = await supabaseAdmin
			.from('organizations')
			.update({
				plan_type: planType,
				max_members: maxMembers
			})
			.eq('id', organizationId);

		if (orgUpdateError) {
			console.error('[Webhook] organizations更新エラー:', orgUpdateError);
			console.error('[Webhook] Organization ID:', organizationId);
			throw new RetryableError(`organizations更新エラー: ${orgUpdateError.message}`);
		}

		console.log('[Webhook] organizations更新成功:', organizationId, 'plan_type:', planType, 'max_members:', maxMembers);
	} else {
		console.log('[Webhook] organization_idが存在しないため、organizationsテーブルは更新しません（個人向けサブスクリプション）');
	}
}

/**
 * customer.subscription.deleted
 * サブスクリプションキャンセル時
 */
async function handleSubscriptionDeleted(subscription: any) {
	console.log('[Webhook] Subscriptionキャンセル:', subscription.id);

	// 1. subscriptionsテーブルから組織IDを取得（削除前に取得）
	const { data: subscriptionData, error: fetchError } = await supabaseAdmin
		.from('subscriptions')
		.select('organization_id')
		.eq('stripe_subscription_id', subscription.id)
		.single();

	if (fetchError || !subscriptionData) {
		// サブスクリプションが見つからない場合は、既に削除済みの可能性がある
		// （例: 組織削除処理で先にsubscriptionsレコードが削除された場合）
		// エラーを投げずに正常終了する
		console.log('[Webhook] サブスクリプションが見つかりません（既に削除済みの可能性）:', subscription.id);
		if (fetchError) {
			console.log('[Webhook] fetchError:', fetchError.message);
		}
		console.log('[Webhook] 処理をスキップします');
		return;
	}

	const organizationId = subscriptionData.organization_id;

	// 2. subscriptionsテーブルを更新（フリープランに降格）
	const { error: updateError } = await supabaseAdmin
		.from('subscriptions')
		.update({
			plan_type: 'free',
			status: 'canceled',
			stripe_subscription_id: null,
			organization_id: null
		})
		.eq('stripe_subscription_id', subscription.id);

	if (updateError) {
		console.error('[Webhook] subscriptions更新エラー:', updateError);
		throw new RetryableError(`subscriptions更新エラー: ${updateError.message}`);
	}

	console.log('[Webhook] subscriptionsをフリープランに降格:', subscription.id);

	// 3. organizationIdが存在する場合のみorganizationsテーブルを更新
	if (organizationId) {
		// 組織の現在のstripe_subscription_idを取得
		const { data: currentOrg, error: orgFetchError } = await supabaseAdmin
			.from('organizations')
			.select('stripe_subscription_id')
			.eq('id', organizationId)
			.single();

		if (orgFetchError) {
			console.error('[Webhook] 組織情報取得エラー:', orgFetchError);
			throw new RetryableError(`組織情報取得エラー: ${orgFetchError.message}`);
		}

		// 削除されたサブスクリプションが組織の現在のサブスクリプションと一致する場合のみ降格
		// アップグレード時は古いサブスクリプションが削除されるが、組織は新しいサブスクリプションを使用している
		if (currentOrg?.stripe_subscription_id === subscription.id) {
			console.log('[Webhook] 削除されたサブスクリプションは組織の現在のサブスクリプションです。フリープランに降格します。');

			// plan_limitsからフリープランのmax_membersを取得
			const { data: planLimits, error: planLimitsError } = await supabaseAdmin
				.from('plan_limits')
				.select('max_organization_members')
				.eq('plan_type', 'free')
				.single();

			if (planLimitsError) {
				const errMsg = 'フリープランのplan_limitsが見つかりません';
				console.error('[Webhook] plan_limits取得エラー:', planLimitsError);
				console.error('[Webhook]', errMsg);
				throw new NonRetryableError(errMsg);
			}

			const maxMembers = planLimits.max_organization_members;

			// organizationsテーブルをフリープランに降格
			const { error: orgUpdateError } = await supabaseAdmin
				.from('organizations')
				.update({
					plan_type: 'free',
					max_members: maxMembers
				})
				.eq('id', organizationId);

			if (orgUpdateError) {
				console.error('[Webhook] organizations更新エラー:', orgUpdateError);
				console.error('[Webhook] Organization ID:', organizationId);
				throw new RetryableError(`organizations更新エラー: ${orgUpdateError.message}`);
			}

			console.log('[Webhook] organizations更新成功:', organizationId, 'フリープランに降格 max_members:', maxMembers);
		} else {
			console.log('[Webhook] 削除されたサブスクリプションは古いものです（アップグレード時の旧サブスクリプション）。組織は更新しません。');
			console.log('[Webhook] 組織の現在のサブスクリプション:', currentOrg?.stripe_subscription_id);
			console.log('[Webhook] 削除されたサブスクリプション:', subscription.id);
		}
	} else {
		console.log('[Webhook] organization_idが存在しないため、organizationsテーブルは更新しません（個人向けサブスクリプション）');
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

	try {
		// Stripe Subscriptionの詳細を取得
		const subscription = await stripe.subscriptions.retrieve(subscriptionId);

		// T13: リプレイ防御 - 現在のDBの状態を取得
		const { data: currentSub, error: fetchError } = await supabaseAdmin
			.from('subscriptions')
			.select('current_period_end, status, cancel_at_period_end')
			.eq('stripe_subscription_id', subscriptionId)
			.single();

		if (fetchError && fetchError.code !== 'PGRST116') {
			// PGRST116 = レコードが見つからない（新規作成の場合は問題ない）
			console.error('[Webhook] 現在のsubscription取得エラー:', fetchError);
			throw new RetryableError(`subscription取得エラー: ${fetchError.message}`);
		}

		const eventPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();

		// T13: 既存レコードがあり、イベントの方が古い場合はスキップ
		// 同一期間内の状態変化（past_due -> active など）は許可するため、< を使用
		if (currentSub?.current_period_end) {
			const currentPeriodEnd = new Date(currentSub.current_period_end).getTime();
			const eventPeriodEndTime = new Date(eventPeriodEnd).getTime();

			if (eventPeriodEndTime < currentPeriodEnd) {
				console.log('[Webhook] 古いイベントを検出 - 更新をスキップ');
				console.log('[Webhook] 現在のcurrent_period_end:', currentSub.current_period_end);
				console.log('[Webhook] イベントのcurrent_period_end:', eventPeriodEnd);
				return; // T13: 古いイベントはスキップ
			}

			// T13最適化: 同一period_endかつ同一内容の場合はDB更新を省略
			if (
				eventPeriodEndTime === currentPeriodEnd &&
				currentSub.status === 'active' &&
				currentSub.cancel_at_period_end === subscription.cancel_at_period_end
			) {
				console.log('[Webhook] 同一内容の重複イベントを検出 - DB更新を省略');
				return;
			}
		}

		// subscriptionsテーブルを更新
		const { error: updateError } = await supabaseAdmin
			.from('subscriptions')
			.update({
				status: 'active',
				current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
				current_period_end: eventPeriodEnd,
				cancel_at_period_end: subscription.cancel_at_period_end
			})
			.eq('stripe_subscription_id', subscriptionId);

		if (updateError) {
			console.error('[Webhook] subscriptions更新エラー:', updateError);
			throw new RetryableError(`subscriptions更新エラー: ${updateError.message}`);
		}

		console.log('[Webhook] subscriptions更新成功 (支払い成功):', subscriptionId);
	} catch (err: any) {
		console.error('[Webhook] handlePaymentSucceeded エラー:', err);
		// 既にカスタムエラーの場合はそのまま再throw
		if (err instanceof NonRetryableError || err instanceof RetryableError) {
			throw err;
		}
		// それ以外（Stripe APIエラーなど）はRetryableErrorとして扱う
		throw new RetryableError(`handlePaymentSucceeded エラー: ${err.message}`);
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

	try {
		// T13: Stripe Subscriptionの詳細を取得（期間情報のため）
		const subscription = await stripe.subscriptions.retrieve(subscriptionId);

		// T13: リプレイ防御 - 現在のDBの状態を取得
		const { data: currentSub, error: fetchError } = await supabaseAdmin
			.from('subscriptions')
			.select('current_period_end, status')
			.eq('stripe_subscription_id', subscriptionId)
			.single();

		if (fetchError && fetchError.code !== 'PGRST116') {
			console.error('[Webhook] 現在のsubscription取得エラー:', fetchError);
			throw new RetryableError(`subscription取得エラー: ${fetchError.message}`);
		}

		const eventPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();

		// T13: 既存レコードがあり、イベントの方が古い場合はスキップ
		if (currentSub?.current_period_end) {
			const currentPeriodEnd = new Date(currentSub.current_period_end).getTime();
			const eventPeriodEndTime = new Date(eventPeriodEnd).getTime();

			if (eventPeriodEndTime < currentPeriodEnd) {
				console.log('[Webhook] 古いイベントを検出 - 更新をスキップ');
				console.log('[Webhook] 現在のcurrent_period_end:', currentSub.current_period_end);
				console.log('[Webhook] イベントのcurrent_period_end:', eventPeriodEnd);
				return; // T13: 古いイベントはスキップ
			}

			// T13最適化: 同一period_endかつ同一内容の場合はDB更新を省略
			if (eventPeriodEndTime === currentPeriodEnd && currentSub.status === 'past_due') {
				console.log('[Webhook] 同一内容の重複イベントを検出 - DB更新を省略');
				return;
			}
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
			throw new RetryableError(`subscriptions更新エラー: ${updateError.message}`);
		}

		console.log('[Webhook] subscriptions更新成功 (支払い失敗):', subscriptionId);

		// TODO: ユーザーにメール通知を送る
	} catch (err: any) {
		console.error('[Webhook] handlePaymentFailed エラー:', err);
		// 既にカスタムエラーの場合はそのまま再throw
		if (err instanceof NonRetryableError || err instanceof RetryableError) {
			throw err;
		}
		// それ以外はRetryableErrorとして扱う
		throw new RetryableError(`handlePaymentFailed エラー: ${err.message}`);
	}
}

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * Price IDからプランタイプを判定（T2: 未知IDは明示エラー化）
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
		// T2: 未知のprice IDは明示的にエラーとして扱う（誤った plan_type 保存を防止）
		const errMsg = `未知のprice ID: ${priceId}。正しいプランタイプを判定できません`;
		console.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}
}
