import { stripe } from '$lib/server/stripe';
import { logger } from '$lib/server/logger';
import {
	supabaseAdmin,
	RetryableError,
	NonRetryableError,
	getInvoiceSubscriptionId,
	requireSubscriptionPeriod,
	isStaleSubscriptionEvent
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
		// 期間は API バージョン差分を吸収して取得（clover では items 側にのみ存在する）
		const period = requireSubscriptionPeriod(subscription);

		// T13: リプレイ防御 - 現在のDBの状態を取得
		const { data: currentSub, error: fetchError } = await supabaseAdmin
			.from('subscriptions')
			.select('current_period_start, current_period_end, status, cancel_at_period_end')
			.eq('stripe_subscription_id', subscriptionId)
			.single();

		if (fetchError && fetchError.code !== 'PGRST116') {
			// PGRST116 = レコードが見つからない（新規作成の場合は問題ない）
			logger.error('[Webhook] 現在のsubscription取得エラー:', fetchError);
			throw new RetryableError(`subscription取得エラー: ${fetchError.message}`);
		}

		const eventPeriodEnd = new Date(period.end * 1000).toISOString();

		// P2-E: status は Stripe の実体を書く。
		// ⚠️ 以前は 'active' を固定で書いていたが、請求書が1通支払われても
		// 別の請求書が未払いならサブスクリプションは past_due のままになる。
		// 直前で retrieve 済みの本物のステータスがあるのに、それを捨てて
		// 「支払われた＝active」と決めつけると DB と Stripe が食い違う。
		const effectiveStatus = subscription.status;

		// T13: 既存レコードがあり、イベントの方が古い場合はスキップ
		// P2-H: period_end の後退だけで判定しない（判定根拠は shared.ts を参照）
		if (isStaleSubscriptionEvent(currentSub, period)) {
			logger.debug('[Webhook] 古いイベントを検出 - 更新をスキップ');
			logger.debug('[Webhook] 現在のcurrent_period_end:', currentSub?.current_period_end);
			logger.debug('[Webhook] イベントのcurrent_period_end:', eventPeriodEnd);
			return;
		}

		if (currentSub?.current_period_end) {
			const currentPeriodEnd = new Date(currentSub.current_period_end).getTime();
			const eventPeriodEndTime = new Date(eventPeriodEnd).getTime();

			// T13最適化: 同一period_endかつ同一内容の場合はDB更新を省略
			// （invoice.paid と invoice.payment_succeeded の二重受信はここで吸収される）
			if (
				eventPeriodEndTime === currentPeriodEnd &&
				currentSub.status === effectiveStatus &&
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
				status: effectiveStatus,
				current_period_start: new Date(period.start * 1000).toISOString(),
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
		// 期間は API バージョン差分を吸収して取得（clover では items 側にのみ存在する）
		const period = requireSubscriptionPeriod(subscription);

		// T13: リプレイ防御 - 現在のDBの状態を取得
		const { data: currentSub, error: fetchError } = await supabaseAdmin
			.from('subscriptions')
			.select('current_period_start, current_period_end, status')
			.eq('stripe_subscription_id', subscriptionId)
			.single();

		if (fetchError && fetchError.code !== 'PGRST116') {
			logger.error('[Webhook] 現在のsubscription取得エラー:', fetchError);
			throw new RetryableError(`subscription取得エラー: ${fetchError.message}`);
		}

		const eventPeriodEnd = new Date(period.end * 1000).toISOString();

		// T13: 既存レコードがあり、イベントの方が古い場合はスキップ
		// P2-H: period_end の後退だけで判定しない（判定根拠は shared.ts を参照）
		if (isStaleSubscriptionEvent(currentSub, period)) {
			logger.debug('[Webhook] 古いイベントを検出 - 更新をスキップ');
			logger.debug('[Webhook] 現在のcurrent_period_end:', currentSub?.current_period_end);
			logger.debug('[Webhook] イベントのcurrent_period_end:', eventPeriodEnd);
			return;
		}

		if (currentSub?.current_period_end) {
			const currentPeriodEnd = new Date(currentSub.current_period_end).getTime();
			const eventPeriodEndTime = new Date(eventPeriodEnd).getTime();

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
