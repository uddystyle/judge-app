import { logger } from '$lib/server/logger';
import {
	supabaseAdmin,
	RetryableError,
	NonRetryableError,
	getPlanTypeFromPrice,
	getSubscriptionPeriod
} from './shared';

/**
 * customer.subscription.created
 * サブスクリプション作成時（checkoutの後に来る）
 */
export async function handleSubscriptionCreated(subscription: any) {
	logger.debug('[Webhook] Subscription作成:', subscription.id);

	const customerId = subscription.customer;

	// Customer IDからuser_idとorganization_idを取得
	const { data: subData, error: fetchError } = await supabaseAdmin
		.from('subscriptions')
		.select('user_id, organization_id')
		.eq('stripe_customer_id', customerId)
		.single();

	if (fetchError || !subData) {
		// イベント順序レース対策: customer.subscription.created が checkout.session.completed より
		// 先に届くと subscriptions 行がまだ存在しない。NonRetryable(400) だと Stripe が再送せず
		// イベントが恒久的にドロップされるため、Retryable(500) にして行が作られるまで再送させる。
		const errMsg = `Customer ID: ${customerId} のsubscriptionが見つかりません`;
		logger.error('[Webhook] subscription取得エラー:', fetchError);
		logger.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}

	// T10/T11: Stripe Subscriptionレスポンスの異常データ検証
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

	// T10/T11: getPlanTypeFromPriceは未知price IDでRetryableErrorを投げる（T2で実装済み）
	const planType = getPlanTypeFromPrice(item.price.id);
	const billingInterval = item.price.recurring?.interval || 'month';

	// 期間フィールドは API バージョン差異に強い方法で取得（Basil 対応）
	const period = getSubscriptionPeriod(subscription);
	if (!period) {
		throw new RetryableError(
			'subscription の current_period が取得できません（Stripe API バージョン不一致の可能性）'
		);
	}

	// 1. subscriptionsテーブルを更新
	const { error: updateError } = await supabaseAdmin
		.from('subscriptions')
		.update({
			stripe_subscription_id: subscription.id,
			plan_type: planType,
			billing_interval: billingInterval,
			status: subscription.status,
			current_period_start: new Date(period.start * 1000).toISOString(),
			current_period_end: new Date(period.end * 1000).toISOString(),
			cancel_at_period_end: subscription.cancel_at_period_end
		})
		.eq('stripe_subscription_id', subscription.id);

	if (updateError) {
		logger.error('[Webhook] subscriptions更新エラー:', updateError);
		throw new RetryableError(`subscriptions更新エラー: ${updateError.message}`);
	}

	logger.debug('[Webhook] subscriptions更新成功:', subData.user_id, planType);

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
			logger.error('[Webhook] plan_limits取得エラー:', planLimitsError);
			logger.error('[Webhook]', errMsg);
			throw new NonRetryableError(errMsg);
		}

		const maxMembers = planLimits.max_organization_members;

		// organizationsテーブルを更新
		const { error: orgUpdateError } = await supabaseAdmin
			.from('organizations')
			.update({
				plan_type: planType,
				max_members: maxMembers,
				stripe_subscription_id: subscription.id
			})
			.eq('id', subData.organization_id);

		if (orgUpdateError) {
			logger.error('[Webhook] organizations更新エラー:', orgUpdateError);
			logger.error('[Webhook] Organization ID:', subData.organization_id);
			throw new RetryableError(`organizations更新エラー: ${orgUpdateError.message}`);
		}

		logger.debug(
			'[Webhook] organizations更新成功:',
			subData.organization_id,
			'plan_type:',
			planType,
			'max_members:',
			maxMembers
		);
	} else {
		logger.debug(
			'[Webhook] organization_idが存在しないため、organizationsテーブルは更新しません（個人向けサブスクリプション）'
		);
	}
}

/**
 * customer.subscription.updated
 * プラン変更時
 */
export async function handleSubscriptionUpdated(subscription: any) {
	logger.debug('[Webhook] Subscription更新:', subscription.id);

	// T11: Stripe Subscriptionレスポンスの異常データ検証（T10と同様）
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

	// T11: getPlanTypeFromPriceは未知price IDでRetryableErrorを投げる（T2で実装済み）
	const planType = getPlanTypeFromPrice(item.price.id);
	const billingInterval = item.price.recurring?.interval || 'month';

	// 期間フィールドは API バージョン差異に強い方法で取得（Basil 対応）
	const period = getSubscriptionPeriod(subscription);
	if (!period) {
		throw new RetryableError(
			'subscription の current_period が取得できません（Stripe API バージョン不一致の可能性）'
		);
	}

	// T13: subscriptionsテーブルから組織IDと現在の期間を取得
	const { data: subscriptionData, error: fetchError } = await supabaseAdmin
		.from('subscriptions')
		.select(
			'organization_id, current_period_end, status, cancel_at_period_end, plan_type, billing_interval'
		)
		.eq('stripe_subscription_id', subscription.id)
		.single();

	if (fetchError || !subscriptionData) {
		// イベント順序レース対策: customer.subscription.updated が checkout.session.completed より
		// 先に届くと該当行がまだ存在しない。NonRetryable(400) だと Stripe が再送せず恒久ドロップに
		// なるため、Retryable(500) にして行が作られるまで再送させる。
		const errMsg = `Subscription ID: ${subscription.id} が見つかりません`;
		logger.error('[Webhook] subscription取得エラー:', fetchError);
		logger.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}

	const organizationId = subscriptionData.organization_id;

	// T13: リプレイ防御 - イベントの方が古い場合はスキップ
	// 同一期間内の状態変化（プラン変更、status変化など）は許可するため、< を使用
	const eventPeriodEnd = new Date(period.end * 1000).toISOString();
	if (subscriptionData.current_period_end) {
		const currentPeriodEnd = new Date(subscriptionData.current_period_end).getTime();
		const eventPeriodEndTime = new Date(eventPeriodEnd).getTime();

		if (eventPeriodEndTime < currentPeriodEnd) {
			logger.debug('[Webhook] 古いイベントを検出 - 更新をスキップ');
			logger.debug('[Webhook] 現在のcurrent_period_end:', subscriptionData.current_period_end);
			logger.debug('[Webhook] イベントのcurrent_period_end:', eventPeriodEnd);
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
			logger.debug('[Webhook] 同一内容の重複イベントを検出 - DB更新を省略');
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
			current_period_start: new Date(period.start * 1000).toISOString(),
			current_period_end: new Date(period.end * 1000).toISOString(),
			cancel_at_period_end: subscription.cancel_at_period_end
		})
		.eq('stripe_subscription_id', subscription.id);

	if (updateError) {
		logger.error('[Webhook] subscriptions更新エラー:', updateError);
		throw new RetryableError(`subscriptions更新エラー: ${updateError.message}`);
	}

	logger.debug('[Webhook] subscriptions更新成功:', subscription.id, planType);

	// 3. organizationIdが存在する場合のみorganizationsテーブルを更新
	if (organizationId) {
		// 支払い停止（unpaid / canceled 等の非課金ステータス）の場合は free 制限に降格する。
		// past_due は Stripe のリトライ猶予期間として現プランを維持（active / trialing も維持）。
		// これにより past_due/unpaid のまま上位プランの上限を保持し続ける問題を防ぐ。
		const ENTITLED_STATUSES = ['active', 'trialing', 'past_due'];
		const effectivePlanType = ENTITLED_STATUSES.includes(subscription.status) ? planType : 'free';

		// plan_limitsから有効プランのmax_membersを取得
		const { data: planLimits, error: planLimitsError } = await supabaseAdmin
			.from('plan_limits')
			.select('max_organization_members')
			.eq('plan_type', effectivePlanType)
			.single();

		if (planLimitsError) {
			const errMsg = `プランタイプ: ${effectivePlanType} のplan_limitsが見つかりません`;
			logger.error('[Webhook] plan_limits取得エラー:', planLimitsError);
			logger.error('[Webhook]', errMsg);
			throw new NonRetryableError(errMsg);
		}

		const maxMembers = planLimits.max_organization_members;

		// organizationsテーブルを更新（非課金ステータス時は free に降格）
		const { error: orgUpdateError } = await supabaseAdmin
			.from('organizations')
			.update({
				plan_type: effectivePlanType,
				max_members: maxMembers
			})
			.eq('id', organizationId);

		if (orgUpdateError) {
			logger.error('[Webhook] organizations更新エラー:', orgUpdateError);
			logger.error('[Webhook] Organization ID:', organizationId);
			throw new RetryableError(`organizations更新エラー: ${orgUpdateError.message}`);
		}

		logger.debug(
			'[Webhook] organizations更新成功:',
			organizationId,
			'plan_type:',
			planType,
			'max_members:',
			maxMembers
		);
	} else {
		logger.debug(
			'[Webhook] organization_idが存在しないため、organizationsテーブルは更新しません（個人向けサブスクリプション）'
		);
	}
}

/**
 * customer.subscription.deleted
 * サブスクリプションキャンセル時
 */
export async function handleSubscriptionDeleted(subscription: any) {
	logger.debug('[Webhook] Subscriptionキャンセル:', subscription.id);

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
		logger.debug(
			'[Webhook] サブスクリプションが見つかりません（既に削除済みの可能性）:',
			subscription.id
		);
		if (fetchError) {
			logger.debug('[Webhook] fetchError:', fetchError.message);
		}
		logger.debug('[Webhook] 処理をスキップします');
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
		logger.error('[Webhook] subscriptions更新エラー:', updateError);
		throw new RetryableError(`subscriptions更新エラー: ${updateError.message}`);
	}

	logger.debug('[Webhook] subscriptionsをフリープランに降格:', subscription.id);

	// 3. organizationIdが存在する場合のみorganizationsテーブルを更新
	if (organizationId) {
		// 組織の現在のstripe_subscription_idを取得
		const { data: currentOrg, error: orgFetchError } = await supabaseAdmin
			.from('organizations')
			.select('stripe_subscription_id')
			.eq('id', organizationId)
			.single();

		if (orgFetchError) {
			logger.error('[Webhook] 組織情報取得エラー:', orgFetchError);
			throw new RetryableError(`組織情報取得エラー: ${orgFetchError.message}`);
		}

		// 削除されたサブスクリプションが組織の現在のサブスクリプションと一致する場合のみ降格
		// アップグレード時は古いサブスクリプションが削除されるが、組織は新しいサブスクリプションを使用している
		if (currentOrg?.stripe_subscription_id === subscription.id) {
			logger.debug(
				'[Webhook] 削除されたサブスクリプションは組織の現在のサブスクリプションです。フリープランに降格します。'
			);

			// plan_limitsからフリープランのmax_membersを取得
			const { data: planLimits, error: planLimitsError } = await supabaseAdmin
				.from('plan_limits')
				.select('max_organization_members')
				.eq('plan_type', 'free')
				.single();

			if (planLimitsError) {
				const errMsg = 'フリープランのplan_limitsが見つかりません';
				logger.error('[Webhook] plan_limits取得エラー:', planLimitsError);
				logger.error('[Webhook]', errMsg);
				throw new NonRetryableError(errMsg);
			}

			const maxMembers = planLimits.max_organization_members;

			// organizationsテーブルをフリープランに降格
			const { error: orgUpdateError } = await supabaseAdmin
				.from('organizations')
				.update({
					plan_type: 'free',
					max_members: maxMembers,
					stripe_subscription_id: null
					// stripe_customer_id は保持（再アップグレード時に同じカスタマーIDを使用）
				})
				.eq('id', organizationId);

			if (orgUpdateError) {
				logger.error('[Webhook] organizations更新エラー:', orgUpdateError);
				logger.error('[Webhook] Organization ID:', organizationId);
				throw new RetryableError(`organizations更新エラー: ${orgUpdateError.message}`);
			}

			logger.debug('[Webhook] organizations更新成功 - フリープランに降格:', {
				organizationId,
				max_members: maxMembers,
				stripe_subscription_id: 'cleared'
			});
		} else {
			logger.debug(
				'[Webhook] 削除されたサブスクリプションは古いものです（アップグレード時の旧サブスクリプション）。組織は更新しません。'
			);
			logger.debug('[Webhook] 組織の現在のサブスクリプション:', currentOrg?.stripe_subscription_id);
			logger.debug('[Webhook] 削除されたサブスクリプション:', subscription.id);
		}
	} else {
		logger.debug(
			'[Webhook] organization_idが存在しないため、organizationsテーブルは更新しません（個人向けサブスクリプション）'
		);
	}
}
