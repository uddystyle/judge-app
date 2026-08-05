/**
 * Stripe API バージョン差分の吸収レイヤー
 *
 * `current_period_start` / `current_period_end` は API `2025-03-31.basil` で Subscription の
 * トップレベルから削除され、`items.data[].current_period_*` へ移動した。
 * 本アプリが pin しているのは `2025-10-29.clover`（basil 以降）なので、
 * `subscriptions.retrieve()` / `subscriptions.update()` の戻り値にトップレベルの期間は**無い**。
 *
 * 一方 Webhook の payload は「エンドポイントに設定された API バージョン」で届くため、
 * 旧バージョンのままなら（あるいは再送された過去イベントなら）トップレベルに入っている。
 * どちらで来ても壊れないよう、両形状を読む。
 *
 * ⚠️ ここを型キャストで誤魔化さないこと。以前あった `withSubscriptionPeriods()` は実体が
 * `as` キャストのみで、SDK の型からフィールドが消えたという破壊の予兆を握り潰し、
 * 「決済は成立するがサブスクリプションが1件も保存されない」障害の直接原因になった。
 */
export function getSubscriptionPeriod(subscription: any): { start: number; end: number } | null {
	const item = subscription?.items?.data?.[0];
	const start = subscription?.current_period_start ?? item?.current_period_start;
	const end = subscription?.current_period_end ?? item?.current_period_end;
	if (typeof start !== 'number' || typeof end !== 'number') return null;
	return { start, end };
}

/** 期間が取れないことを表す共通メッセージ（呼び出し側でエラー種別を決める） */
export const SUBSCRIPTION_PERIOD_MISSING =
	'subscription の current_period が取得できません（Stripe API バージョン不一致の可能性）';
