import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { findPlanTypeByPriceId } from '$lib/server/plans';
import { logger } from '$lib/server/logger';

/**
 * Stripe Webhook ハンドラー共通部品
 * （エラー分類・管理クライアント・APIバージョン差の吸収・プラン判定）
 */

// Service Role Keyを使用してSupabaseクライアントを作成（RLSをバイパス）
export const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * リトライ可能なエラー（500番台を返す）
 * - データベース接続エラー
 * - Stripe API一時的障害
 * - その他のサーバー側の一時的な問題
 */
export class RetryableError extends Error {
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
export class NonRetryableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NonRetryableError';
	}
}

/**
 * Stripe Basil（API 2025-03-31 以降）では Subscription.current_period_start/end が
 * トップレベルから削除され subscription.items.data[].current_period_* へ移動した。
 * また Invoice.subscription も削除され invoice.parent.subscription_details.subscription へ移動した。
 * Webhook エンドポイントに設定された API バージョンに依存せず動くよう、両形状を防御的に読む
 * （pin された SDK 経由の subscriptions.retrieve() は acacia 形状=トップレベルを返す）。
 */
export function getSubscriptionPeriod(subscription: any): { start: number; end: number } | null {
	const item = subscription?.items?.data?.[0];
	const start = subscription?.current_period_start ?? item?.current_period_start;
	const end = subscription?.current_period_end ?? item?.current_period_end;
	if (typeof start !== 'number' || typeof end !== 'number') return null;
	return { start, end };
}

export function getInvoiceSubscriptionId(invoice: any): string | null {
	const sub = invoice?.subscription ?? invoice?.parent?.subscription_details?.subscription;
	if (!sub) return null;
	return typeof sub === 'string' ? sub : (sub?.id ?? null);
}

/**
 * Price IDからプランタイプを判定（T2: 未知IDは明示エラー化）
 * マッピングの実体は $lib/server/plans に一元化されている
 */
export function getPlanTypeFromPrice(
	priceId: string
): 'free' | 'standard' | 'pro' | 'basic' | 'premium' {
	const planType = findPlanTypeByPriceId(priceId);

	if (!planType) {
		// T2: 未知のprice IDは明示的にエラーとして扱う（誤った plan_type 保存を防止）
		const errMsg = `未知のprice ID: ${priceId}。正しいプランタイプを判定できません`;
		logger.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}

	return planType;
}
