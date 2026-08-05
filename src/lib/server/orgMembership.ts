import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '$lib/server/logger';

/**
 * 組織への参加・再参加を一手に扱う。
 *
 * ⚠️ `organization_members` には UNIQUE (organization_id, user_id) がある。
 * 退会は `removed_at` を立てる論理削除で行が残るため、**再参加を単純な INSERT で行うと
 * 一意制約違反で必ず失敗する**。退会済みの行がある場合は UPDATE で復帰させる
 * （管理者向けの復元 API `members/[memberId]` の PATCH と同じ方式）。
 *
 * ⚠️ 復帰時の role は**呼び出し側の指定で上書きする**。UPDATE で role を触らないと、
 * 退会前に admin だった人が招待リンク経由で admin として戻る。招待した側は一般メンバーを
 * 招いたつもりでも管理者権限が付いてしまうため、招待経由は 'member' を渡すこと。
 *
 * ⚠️ `joined_at` は触らない（既存の復元 API と揃える）。初回参加の記録を残す。
 *
 * ⚠️ メンバー上限の確認（checkCanAddMember）は**呼び出し側の責務**。復帰も1名分の
 * 増加なので、上限チェックを飛ばさないこと。
 */
export interface JoinOrRestoreParams {
	organizationId: string;
	userId: string;
	/** 参加後の role。招待経由の再参加は 'member' を指定する */
	role: 'admin' | 'member';
}

export type JoinOrRestoreResult =
	| { ok: true; restored: boolean }
	| { ok: false; alreadyMember: true }
	| { ok: false; alreadyMember?: false; error: string };

export async function joinOrRestoreMember(
	supabase: SupabaseClient,
	{ organizationId, userId, role }: JoinOrRestoreParams
): Promise<JoinOrRestoreResult> {
	// 在籍中・退会済みの両方を拾うため removed_at で絞らない
	const { data: existing, error: fetchError } = await supabase
		.from('organization_members')
		.select('id, role, removed_at')
		.eq('organization_id', organizationId)
		.eq('user_id', userId)
		.maybeSingle();

	if (fetchError) {
		logger.error('[orgMembership] 既存メンバーの確認に失敗:', fetchError);
		return { ok: false, error: '組織メンバーの確認に失敗しました。' };
	}

	if (existing && !existing.removed_at) {
		return { ok: false, alreadyMember: true };
	}

	if (existing) {
		// 退会済み → 復帰。role は指定値で上書きする
		const { error: restoreError } = await supabase
			.from('organization_members')
			.update({ removed_at: null, removed_by: null, role })
			.eq('id', existing.id);

		if (restoreError) {
			logger.error('[orgMembership] 復帰に失敗:', restoreError);
			return { ok: false, error: '組織への参加に失敗しました。' };
		}
		return { ok: true, restored: true };
	}

	const { error: insertError } = await supabase.from('organization_members').insert({
		organization_id: organizationId,
		user_id: userId,
		role
	});

	if (insertError) {
		logger.error('[orgMembership] 参加に失敗:', insertError);
		return { ok: false, error: '組織への参加に失敗しました。' };
	}
	return { ok: true, restored: false };
}
