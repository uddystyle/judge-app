import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const DEFAULT_INVITATION_EXPIRES_HOURS = 48;
export const MAX_INVITATION_EXPIRES_HOURS = 168;

/**
 * 使用回数の既定は**無制限**（null）。
 *
 * 組織の招待は「1本のリンクを配って、その組織のメンバー全員に参加してもらう」運用を想定している。
 * 既定を1回にすると人数分のリンクを個別発行することになり、運用が成立しない。
 *
 * 無制限の歯止めは他の3つで担保する:
 *   - 有効期限（既定48時間）
 *   - 管理者による失効（revoked_at）
 *   - プランのメンバー上限（checkCanAddMember）
 */
export const DEFAULT_INVITATION_MAX_USES: number | null = null;

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function hashInvitationToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function parseInvitationExpiresInHours(value: unknown): number {
	if (value === undefined || value === null) return DEFAULT_INVITATION_EXPIRES_HOURS;

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_INVITATION_EXPIRES_HOURS) {
		throw new Error(`expiresInHours must be between 1 and ${MAX_INVITATION_EXPIRES_HOURS}`);
	}

	return parsed;
}

export function parseInvitationMaxUses(value: unknown): number | null {
	if (value === undefined || value === null) return DEFAULT_INVITATION_MAX_USES;

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
		throw new Error('maxUses must be between 1 and 100');
	}

	return parsed;
}

/**
 * 招待の使用権を1つ確定する（使用回数の上限を同時実行でも守る）。
 *
 * ⚠️ `used_count: invitation.used_count + 1` のように**読んで足して書く**形にしないこと。
 * 同時に2人が受諾すると両方が「0 を読んで 1 を書く」ため、`max_uses` を超えて参加できる。
 * ここでは「読んだ時点の used_count のままなら +1 する」条件付き UPDATE（CAS）にして、
 * 競合したら負けた側に使用権を渡さない。
 *
 * ⚠️ 呼び出しは**メンバー追加より前**に行うこと。先にメンバーを追加してから数えると、
 * 上限を超えた参加が成立したあとで気づくことになる。
 */
export async function claimInvitationUse(
	supabase: SupabaseClient,
	invitation: { id: string; used_count: number; max_uses: number | null }
): Promise<{ claimed: boolean }> {
	if (invitation.max_uses !== null && invitation.used_count >= invitation.max_uses) {
		return { claimed: false };
	}

	const { data, error } = await supabase
		.from('invitations')
		.update({ used_count: invitation.used_count + 1 })
		.eq('id', invitation.id)
		.eq('used_count', invitation.used_count)
		.select('id');

	if (error || !data || data.length === 0) {
		return { claimed: false };
	}

	return { claimed: true };
}

/**
 * 使用権を戻す（メンバー追加に失敗したときの後始末）。
 *
 * 失敗しても例外は投げない。戻せなかった場合に減るのは「残り使用回数」だけで、
 * 上限を超えた参加は起きないため、ここで処理を止める方が有害。
 */
export async function releaseInvitationUse(
	supabase: SupabaseClient,
	invitation: { id: string; used_count: number }
): Promise<void> {
	await supabase
		.from('invitations')
		.update({ used_count: invitation.used_count })
		.eq('id', invitation.id)
		.eq('used_count', invitation.used_count + 1);
}

export async function getInvitationByToken(supabase: SupabaseClient, token: string) {
	const tokenHash = hashInvitationToken(token);
	const { data, error } = await supabase
		.from('invitations')
		.select(
			`
			*,
			organizations!organization_id (
				id,
				name,
				plan_type
			)
		`
		)
		.eq('token_hash', tokenHash)
		.single();

	if (error) {
		return { invitation: null, error };
	}

	return { invitation: data, error: null };
}

export function getInvitationInvalidReason(invitation: any): string | null {
	if (!invitation) return '無効な招待です';
	if (invitation.revoked_at) return 'この招待は失効済みです';
	if (new Date(invitation.expires_at) < new Date()) return '招待の有効期限が切れています';
	if (invitation.max_uses !== null && invitation.used_count >= invitation.max_uses) {
		return '招待の使用回数が上限に達しています';
	}
	return null;
}

export function isInvitationEmailAllowed(invitation: any, userEmail: string | null | undefined) {
	if (!invitation.email) return true;
	if (!userEmail) return false;
	return normalizeEmail(invitation.email) === normalizeEmail(userEmail);
}
