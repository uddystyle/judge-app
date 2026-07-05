import { stripe } from '$lib/server/stripe';
import { logger } from '$lib/server/logger';
import { supabaseAdmin, RetryableError, NonRetryableError, getPlanTypeFromPrice } from './shared';

/**
 * checkout.session.completed
 * 新規サブスクリプション登録成功時
 */
export async function handleCheckoutCompleted(session: any) {
	logger.debug('[Webhook] Checkout完了:', session.id);

	const userId = session.metadata?.user_id;
	const customerId = session.customer;
	const subscriptionId = session.subscription;
	const isOrganizationStr = session.metadata?.is_organization;

	// 必須データの検証（リトライ不要なエラー）
	if (!userId || !customerId) {
		const errMsg = 'user_idまたはcustomer_idが見つかりません';
		logger.error('[Webhook]', errMsg);
		throw new NonRetryableError(errMsg);
	}

	if (!subscriptionId) {
		const errMsg = 'Subscription IDが見つかりません';
		logger.error('[Webhook]', errMsg);
		throw new NonRetryableError(errMsg);
	}

	// is_organization の検証（T1）
	if (!isOrganizationStr || (isOrganizationStr !== 'true' && isOrganizationStr !== 'false')) {
		const errMsg = 'is_organizationは"true"または"false"である必要があります';
		logger.error('[Webhook]', errMsg, '値:', isOrganizationStr);
		throw new NonRetryableError(errMsg);
	}

	const isOrganization = isOrganizationStr === 'true';

	// Stripe Subscriptionの詳細を取得（リトライ可能なエラー）
	let subscription;
	try {
		subscription = await stripe.subscriptions.retrieve(subscriptionId);
	} catch (err: any) {
		logger.error('[Webhook] Stripe API エラー:', err.message);
		logger.error('[Webhook] Subscription ID:', subscriptionId);
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
			logger.error('[Webhook]', errMsg);
			throw new RetryableError(errMsg);
		}

		const item = subscription.items.data[0];
		if (!item.price || !item.price.id) {
			const errMsg = 'subscription.items.data[0].priceが見つかりません';
			logger.error('[Webhook]', errMsg);
			throw new RetryableError(errMsg);
		}

		const priceId = item.price.id;
		const planType = getPlanTypeFromPrice(priceId);
		const billingInterval = item.price.recurring?.interval || 'month';

		logger.debug(
			'[Webhook] Price ID:',
			priceId,
			'→ プランタイプ:',
			planType,
			'課金間隔:',
			billingInterval
		);

		const { error: upsertError } = await supabaseAdmin.from('subscriptions').upsert(
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
			logger.error('[Webhook] subscriptions更新エラー:', upsertError);
			throw new RetryableError(`データベース更新エラー: ${upsertError.message}`);
		}

		logger.debug('[Webhook] subscriptions更新成功:', userId, planType);
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
		logger.error('[Webhook]', errMsg);
		throw new NonRetryableError(errMsg);
	}

	// max_members の検証（T1）
	const maxMembers = parseInt(maxMembersStr);
	if (isNaN(maxMembers) || maxMembers <= 0) {
		const errMsg = 'max_membersは正の整数である必要があります';
		logger.error('[Webhook]', errMsg, '値:', maxMembersStr);
		throw new NonRetryableError(errMsg);
	}

	// is_upgrade の検証（T1）
	if (isUpgradeStr && isUpgradeStr !== 'true' && isUpgradeStr !== 'false') {
		const errMsg = 'is_upgradeは"true"または"false"である必要があります';
		logger.error('[Webhook]', errMsg, '値:', isUpgradeStr);
		throw new NonRetryableError(errMsg);
	}

	const isUpgrade = isUpgradeStr === 'true';

	// T9: is_upgrade=trueの場合はorganization_idが必須
	if (isUpgrade && !organizationId) {
		const errMsg = 'is_upgrade=trueの場合はorganization_idが必須です';
		logger.error('[Webhook]', errMsg);
		throw new NonRetryableError(errMsg);
	}

	// metadata検証後に price/plan情報を取得（T2）
	// T10: Stripe Subscriptionレスポンスの異常データ検証
	if (!subscription.items?.data || subscription.items.data.length === 0) {
		const errMsg = 'subscription.items.dataが空です';
		logger.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}

	const item = subscription.items.data[0];
	if (!item.price || !item.price.id) {
		const errMsg = 'subscription.items.data[0].priceが見つかりません';
		logger.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}

	const priceId = item.price.id;
	const planType = getPlanTypeFromPrice(priceId);
	const billingInterval = item.price.recurring?.interval || 'month';

	logger.debug(
		'[Webhook] Price ID:',
		priceId,
		'→ プランタイプ:',
		planType,
		'課金間隔:',
		billingInterval
	);

	try {
		// アップグレードの場合
		if (isUpgrade && organizationId) {
			logger.debug('[Webhook] 組織アップグレード開始:', organizationId);
			logger.debug('[Webhook] プランタイプ:', planType, '最大メンバー:', maxMembers);

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
				logger.error('[Webhook] 古いサブスクリプションのクリアエラー:', oldSubClearError);
				throw new RetryableError(
					`古いサブスクリプションのクリアエラー: ${oldSubClearError.message}`
				);
			}

			logger.debug('[Webhook] 古いサブスクリプションをクリアしました');

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
				logger.error('[Webhook] 組織更新エラー:', orgError);
				throw new RetryableError(`組織更新エラー: ${orgError.message}`);
			}

			logger.debug('[Webhook] 組織更新成功:', organizationId, 'plan_type:', planType);

			// 3. 新しいサブスクリプションをUPSERT（UNIQUE制約違反なし）
			const { error: subError } = await supabaseAdmin.from('subscriptions').upsert(
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
				logger.error('[Webhook] subscription作成エラー:', subError);
				throw new RetryableError(`subscription作成エラー: ${subError.message}`);
			}

			// 4. 旧Stripeサブスクリプションを解約（SEC-1: 二重課金防止）
			// DB上のクリア（手順1）だけではStripe側の課金が継続するため、同一Customerの
			// 他のサブスクリプションをStripe側でも解約する。組織は既に新サブスクリプションを
			// 指している（手順2）ため、この解約で発火する customer.subscription.deleted が
			// handleSubscriptionDeleted の一致チェックで組織を free に降格させることはない。
			// 失敗時は RetryableError で再送させる（DB操作はすべてUPSERT/条件付きで冪等）。
			//
			// SEC-1b: 非同期決済（動的支払い方法で有効化され得る）では、checkout完了時点で
			// 新サブスクが incomplete（決済未確定）のことがある。後で決済が失敗した場合に
			// 組織が課金中の旧サブスクを失わないよう、決済確定時のみ解約する。
			if (!['active', 'trialing'].includes(subscription.status)) {
				// 監視で検知できるよう高重大度で記録（決済確定後、旧サブスクは二重課金状態のため
				// 手動解約が必要になり得る。JPYサブスクは実質カードのみのため発生確率は極めて低い）
				logger.error(
					'[Webhook] SEC-1b: 新サブスクリプションが未確定のため旧サブスクリプション解約をスキップ:',
					subscriptionId,
					'status:',
					subscription.status
				);
			} else {
				let oldStripeSubs;
				try {
					oldStripeSubs = await stripe.subscriptions.list({ customer: customerId, limit: 100 });
				} catch (err: any) {
					logger.error('[Webhook] 旧サブスクリプション一覧取得エラー:', err.message);
					throw new RetryableError(`旧サブスクリプション一覧取得エラー: ${err.message}`);
				}

				for (const oldSub of oldStripeSubs.data) {
					if (oldSub.id === subscriptionId) continue;
					if (oldSub.status === 'canceled') continue;
					try {
						await stripe.subscriptions.cancel(oldSub.id);
						logger.debug('[Webhook] 旧サブスクリプションをStripeで解約:', oldSub.id);
					} catch (err: any) {
						if (err?.code === 'resource_missing') {
							logger.debug('[Webhook] 旧サブスクリプションは既に存在しません:', oldSub.id);
							continue;
						}
						logger.error('[Webhook] 旧サブスクリプション解約エラー:', oldSub.id, err.message);
						throw new RetryableError(`旧サブスクリプション解約エラー: ${err.message}`);
					}
				}
			}

			logger.debug('[Webhook] 組織アップグレード完了:', organizationId);
		}
		// 新規作成の場合
		else {
			logger.debug('[Webhook] 組織作成開始:', organizationName);

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
				logger.error('[Webhook] 組織作成/取得エラー:', orgError);
				throw new RetryableError(`組織作成/取得エラー: ${orgError.message}`);
			}

			logger.debug('[Webhook] 組織作成/取得成功:', organization.id);

			// 2. 作成者を管理者としてメンバーに追加（べき等性確保のためUPSERT使用）
			// organization_id + user_idがユニーク制約のため、Webhook再送時は既存メンバーを更新
			const { error: memberError } = await supabaseAdmin.from('organization_members').upsert(
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
				logger.error('[Webhook] メンバー追加エラー:', memberError);
				logger.error('[Webhook] エラー詳細:', JSON.stringify(memberError, null, 2));
				// メンバー追加失敗は致命的ではないので、警告のみでエラーを投げない
				logger.warn('[Webhook] メンバー追加に失敗しましたが処理を継続します');
			} else {
				logger.debug('[Webhook] 管理者メンバー追加成功:', userId);
			}

			// 3. subscriptionsテーブルに組織情報を保存（べき等性確保のためUPSERT使用）
			// stripe_subscription_idがユニーク制約のため、Webhook再送時は既存サブスクリプションを更新
			const { error: subError } = await supabaseAdmin.from('subscriptions').upsert(
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
				logger.error('[Webhook] subscription作成/更新エラー:', subError);
				logger.error('[Webhook] エラー詳細:', JSON.stringify(subError, null, 2));
				throw new RetryableError(`subscription作成/更新エラー: ${subError.message}`);
			}

			logger.debug('[Webhook] 組織向けサブスクリプション作成/更新完了:', organization.id);
		}
	} catch (err: any) {
		logger.error('[Webhook] 組織処理でエラー:', err);
		// 既にカスタムエラーの場合はそのまま再throw
		if (err instanceof NonRetryableError || err instanceof RetryableError) {
			throw err;
		}
		// それ以外はRetryableErrorとして扱う
		throw new RetryableError(`組織処理エラー: ${err.message}`);
	}
}
