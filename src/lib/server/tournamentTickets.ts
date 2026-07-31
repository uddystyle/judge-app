import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '$lib/server/logger';

/**
 * 大会チケット（スポット販売）関連のヘルパー
 *
 * 大会モードは「大会1回 = セッション1つ = チケット1枚」のスポット販売。
 * チケットの付与は運営が service role で tournament_tickets に INSERT し、
 * 消費は sessions への BEFORE INSERT トリガー（migration 1022）が
 * DB 層で原子的に行う。ここでは表示・事前チェック用の参照だけを提供する。
 */

/** 大会モードの利用案内先（見積フォームへのディープリンク） */
export const TOURNAMENT_CONTACT_URL = '/contact?category=tournament_quote';

/** チケット残無し時のユーザー向け文言（DB トリガーの拒否時にも使う） */
export const TOURNAMENT_TICKET_REQUIRED_MESSAGE =
	'大会モードのご利用には大会チケットが必要です。料金はお問い合わせください（1大会ごとのスポット販売）。';

/**
 * 組織の未使用チケット枚数を取得する。
 * RLS により組織メンバーは自組織分のみ参照できる（ユーザークライアントで呼べる）。
 * 取得エラー時は 0 を返す（作成時の最終判定は DB トリガーが行うため安全側で良い）。
 */
export async function countAvailableTickets(
	supabase: SupabaseClient,
	organizationId: string
): Promise<number> {
	const { count, error } = await supabase
		.from('tournament_tickets')
		.select('*', { count: 'exact', head: true })
		.eq('organization_id', organizationId)
		.is('used_at', null);

	if (error) {
		logger.error('[TournamentTickets] チケット数の取得エラー:', error);
		return 0;
	}

	return count || 0;
}
