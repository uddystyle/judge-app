import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { findPlanTypeByPriceId } from '$lib/server/plans';
import { logger } from '$lib/server/logger';
import { getSubscriptionPeriod, SUBSCRIPTION_PERIOD_MISSING } from '$lib/server/stripeTypes';

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
 * 再送しても永久に成功しないエラー（200を返して再送ループを止める）
 * - データ不正
 * - 必須データが見つからない
 * - ビジネスロジックの検証エラー
 *
 * ⚠️ Stripe は **2xx 以外を一律で最大3日間・指数バックオフで再送する**（4xx/5xx を区別しない）。
 * かつて本エラーは 400 を返しており「リトライ不要」と表現していたが、実際には再送が止まらず
 * リトライ嵐とエンドポイント自動無効化のリスクになっていた。
 * 現在は 200 を返し、代わりに error ログで可視化する（監視で拾うこと）。
 */
export class NonRetryableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NonRetryableError';
	}
}

/**
 * このステータスなら有料プランの権限を与えてよい。
 *
 * past_due は Stripe のリトライ猶予期間なので現プランを維持する。
 * incomplete（決済未確定）/ unpaid / canceled 等は権限を与えない。
 */
export const ENTITLED_STATUSES = ['active', 'trialing', 'past_due'];

export function isEntitledStatus(status: string): boolean {
	return ENTITLED_STATUSES.includes(status);
}

/**
 * プランの上限メンバー数を plan_limits から取得する（M-5: 単一の正）。
 *
 * Checkout の metadata にも max_members が入っているが、あれは checkout 作成時点の
 * スナップショットで、plan_limits を変更しても古い値のまま残る。値の出所を
 * plan_limits に一本化し、metadata の max_members は参照しない。
 */
export async function getMaxMembersForPlan(planType: string): Promise<number> {
	const { data, error } = await supabaseAdmin
		.from('plan_limits')
		.select('max_organization_members')
		.eq('plan_type', planType)
		.single();

	if (error || !data) {
		const errMsg = `プランタイプ: ${planType} のplan_limitsが見つかりません`;
		logger.error('[Webhook] plan_limits取得エラー:', error);
		logger.error('[Webhook]', errMsg);
		throw new NonRetryableError(errMsg);
	}

	return data.max_organization_members;
}

// 期間フィールドの API バージョン差分吸収は $lib/server/stripeTypes に一元化されている
export { getSubscriptionPeriod };

/**
 * 期間フィールドを必須として取得する。
 *
 * pin 中の API バージョン（clover）では items 側にしか存在しないため、
 * どちらの形状でも読めなかった場合は構成不整合とみなし RetryableError で再送させる。
 * ここで握り潰すと「決済は成立したのに期間が NULL のまま保存される」状態になるため、
 * 必ず失敗させること。
 */
export function requireSubscriptionPeriod(subscription: any): { start: number; end: number } {
	const period = getSubscriptionPeriod(subscription);
	if (!period) {
		logger.error('[Webhook]', SUBSCRIPTION_PERIOD_MISSING);
		throw new RetryableError(SUBSCRIPTION_PERIOD_MISSING);
	}
	return period;
}

/**
 * Stripe Basil（API 2025-03-31 以降）では Invoice.subscription が削除され
 * invoice.parent.subscription_details.subscription へ移動した。両形状を防御的に読む。
 */
export function getInvoiceSubscriptionId(invoice: any): string | null {
	const sub = invoice?.subscription ?? invoice?.parent?.subscription_details?.subscription;
	if (!sub) return null;
	return typeof sub === 'string' ? sub : (sub?.id ?? null);
}

/**
 * Price IDからプランタイプを判定（T2: 未知IDは明示エラー化）
 * マッピングの実体は $lib/server/plans に一元化されている
 */
export function getPlanTypeFromPrice(priceId: string): 'free' | 'standard' | 'basic' | 'premium' {
	const planType = findPlanTypeByPriceId(priceId);

	if (!planType) {
		// T2: 未知のprice IDは明示的にエラーとして扱う（誤った plan_type 保存を防止）
		const errMsg = `未知のprice ID: ${priceId}。正しいプランタイプを判定できません`;
		logger.error('[Webhook]', errMsg);
		throw new RetryableError(errMsg);
	}

	return planType;
}
