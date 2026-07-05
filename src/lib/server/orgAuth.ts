import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 組織メンバーシップ・管理者権限の判定（単一ソース）
 *
 * organization_members の照会はここに集約する。
 * `.is('removed_at', null)` により退会済みメンバーを必ず除外する
 * （RLS に依存せずサーバー側で保証する。T21 と同じ方針）。
 *
 * 失敗時のレスポンス（error/fail/json/redirect）はサイトごとに要件が異なるため、
 * このモジュールは判定のみを行い、応答は呼び出し側の責務とする。
 */

export type OrgRole = 'admin' | 'member';

/**
 * アクティブな（退会していない）メンバーシップの role を返す。
 * 非メンバー・退会済み・取得エラーの場合は null。
 */
export async function getActiveOrgRole(
	supabase: SupabaseClient,
	organizationId: string,
	userId: string
): Promise<OrgRole | null> {
	const { data: membership } = await supabase
		.from('organization_members')
		.select('role')
		.eq('organization_id', organizationId)
		.eq('user_id', userId)
		.is('removed_at', null)
		.single();

	return (membership?.role as OrgRole | undefined) ?? null;
}

/** アクティブな admin メンバーかどうか */
export async function isOrgAdmin(
	supabase: SupabaseClient,
	organizationId: string,
	userId: string
): Promise<boolean> {
	return (await getActiveOrgRole(supabase, organizationId, userId)) === 'admin';
}
