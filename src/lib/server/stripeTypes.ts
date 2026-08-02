import type Stripe from 'stripe';

/**
 * DB の subscriptions テーブルは Stripe Subscription の期間フィールドを保持している。
 * stripe v19 の型では API バージョン差分により top-level の period fields が
 * 厳密型から外れるため、既存実装の互換レイヤーとして局所的に明示する。
 */
export type SubscriptionWithPeriods = Stripe.Subscription & {
	current_period_start: number;
	current_period_end: number;
};

export function withSubscriptionPeriods(
	subscription: Stripe.Response<Stripe.Subscription> | Stripe.Subscription
): SubscriptionWithPeriods {
	return subscription as SubscriptionWithPeriods;
}
