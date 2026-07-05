import { stripe } from '$lib/server/stripe';
import { logger } from '$lib/server/logger';
import {
	supabaseAdmin,
	RetryableError,
	NonRetryableError,
	getInvoiceSubscriptionId
} from './shared';

/**
 * invoice.payment_succeeded
 * 支払い成功時（更新時）
 */
export async function handlePaymentSucceeded(invoice: any) {
	logger.debug('[Webhook] 支払い成功:', invoice.id);

	const subscriptionId = getInvoiceSubscriptionId(invoice);

	if (!subscriptionId) {
		logger.debug('[Webhook] サブスクリプションIDがありません（単発支払い？）');
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
			logger.error('[Webhook] 現在のsubscription取得エラー:', fetchError);
			throw new RetryableError(`subscription取得エラー: ${fetchError.message}`);
		}

		const eventPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();

		// T13: 既存レコードがあり、イベントの方が古い場合はスキップ
		// 同一期間内の状態変化（past_due -> active など）は許可するため、< を使用
		if (currentSub?.current_period_end) {
			const currentPeriodEnd = new Date(currentSub.current_period_end).getTime();
			const eventPeriodEndTime = new Date(eventPeriodEnd).getTime();

			if (eventPeriodEndTime < currentPeriodEnd) {
				logger.debug('[Webhook] 古いイベントを検出 - 更新をスキップ');
				logger.debug('[Webhook] 現在のcurrent_period_end:', currentSub.current_period_end);
				logger.debug('[Webhook] イベントのcurrent_period_end:', eventPeriodEnd);
				return; // T13: 古いイベントはスキップ
			}

			// T13最適化: 同一period_endかつ同一内容の場合はDB更新を省略
			if (
				eventPeriodEndTime === currentPeriodEnd &&
				currentSub.status === 'active' &&
				currentSub.cancel_at_period_end === subscription.cancel_at_period_end
			) {
				logger.debug('[Webhook] 同一内容の重複イベントを検出 - DB更新を省略');
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
			logger.error('[Webhook] subscriptions更新エラー:', updateError);
			throw new RetryableError(`subscriptions更新エラー: ${updateError.message}`);
		}

		logger.debug('[Webhook] subscriptions更新成功 (支払い成功):', subscriptionId);
	} catch (err: any) {
		logger.error('[Webhook] handlePaymentSucceeded エラー:', err);
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
export async function handlePaymentFailed(invoice: any) {
	logger.debug('[Webhook] 支払い失敗:', invoice.id);

	const subscriptionId = getInvoiceSubscriptionId(invoice);

	if (!subscriptionId) {
		logger.debug('[Webhook] サブスクリプションIDがありません');
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
			logger.error('[Webhook] 現在のsubscription取得エラー:', fetchError);
			throw new RetryableError(`subscription取得エラー: ${fetchError.message}`);
		}

		const eventPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();

		// T13: 既存レコードがあり、イベントの方が古い場合はスキップ
		if (currentSub?.current_period_end) {
			const currentPeriodEnd = new Date(currentSub.current_period_end).getTime();
			const eventPeriodEndTime = new Date(eventPeriodEnd).getTime();

			if (eventPeriodEndTime < currentPeriodEnd) {
				logger.debug('[Webhook] 古いイベントを検出 - 更新をスキップ');
				logger.debug('[Webhook] 現在のcurrent_period_end:', currentSub.current_period_end);
				logger.debug('[Webhook] イベントのcurrent_period_end:', eventPeriodEnd);
				return; // T13: 古いイベントはスキップ
			}

			// T13最適化: 同一period_endかつ同一内容の場合はDB更新を省略
			if (eventPeriodEndTime === currentPeriodEnd && currentSub.status === 'past_due') {
				logger.debug('[Webhook] 同一内容の重複イベントを検出 - DB更新を省略');
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
			logger.error('[Webhook] subscriptions更新エラー:', updateError);
			throw new RetryableError(`subscriptions更新エラー: ${updateError.message}`);
		}

		logger.debug('[Webhook] subscriptions更新成功 (支払い失敗):', subscriptionId);

		// TODO: ユーザーにメール通知を送る
	} catch (err: any) {
		logger.error('[Webhook] handlePaymentFailed エラー:', err);
		// 既にカスタムエラーの場合はそのまま再throw
		if (err instanceof NonRetryableError || err instanceof RetryableError) {
			throw err;
		}
		// それ以外はRetryableErrorとして扱う
		throw new RetryableError(`handlePaymentFailed エラー: ${err.message}`);
	}
}
