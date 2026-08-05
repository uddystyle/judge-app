import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { checkCanAddMember } from '$lib/server/organizationLimits';
import { logger } from '$lib/server/logger';
import { joinOrRestoreMember } from '$lib/server/orgMembership';
import {
	getInvitationByToken,
	getInvitationInvalidReason,
	isInvitationEmailAllowed,
	normalizeEmail,
	claimInvitationUse,
	releaseInvitationUse
} from '$lib/server/invitations';

const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export const load: PageServerLoad = async ({ params, locals }) => {
	const token = params.token;

	// ⚠️ token はそのまま組織参加に使える資格情報。ログに出さない。
	logger.debug('[Invite Complete] Loading invitation completion');

	// 認証チェック
	const {
		data: { user },
		error: userError
	} = await locals.supabase.auth.getUser();

	if (userError || !user) {
		logger.error('[Invite Complete] User not authenticated');
		throw redirect(303, `/login?next=/invite/${token}/complete`);
	}

	logger.debug('[Invite Complete] User authenticated:', {
		userId: user.id,
		email: user.email,
		emailConfirmedAt: user.email_confirmed_at
	});

	// メール確認済みかチェック
	if (!user.email_confirmed_at) {
		logger.warn('[Invite Complete] Email not confirmed yet');
		throw redirect(303, `/invite/${token}/check-email`);
	}

	// 招待情報を取得
	const { invitation, error: inviteError } = await getInvitationByToken(supabaseAdmin, token);

	if (inviteError || !invitation) {
		logger.error('[Invite Complete] Error fetching invitation:', inviteError);
		throw error(404, '招待が見つかりません');
	}

	const invalidReason = getInvitationInvalidReason(invitation);
	if (invalidReason) {
		throw error(410, invalidReason);
	}

	// 招待メールが指定されている場合、ユーザーのメールアドレスと一致するかチェック
	// 正規化して比較することで、大文字小文字の違いや空白による回避を防ぐ
	if (!isInvitationEmailAllowed(invitation, user.email)) {
		logger.error('[Invite Complete] Email mismatch:', {
			invitationEmail: invitation.email,
			userEmail: user.email,
			normalizedInvitation: normalizeEmail(invitation.email),
			normalizedUser: user.email ? normalizeEmail(user.email) : null
		});
		throw error(403, 'この招待は別のメールアドレス宛です');
	}

	// すでにメンバーかチェック
	const { data: existingMembership } = await supabaseAdmin
		.from('organization_members')
		.select('id')
		.eq('organization_id', invitation.organization_id)
		.eq('user_id', user.id)
		.is('removed_at', null)
		.single();

	if (existingMembership) {
		logger.debug('[Invite Complete] User is already a member, redirecting to organization');
		throw redirect(303, `/organization/${invitation.organization_id}`);
	}

	// プロフィールが存在するかチェック（存在しない場合は作成）
	const { data: existingProfile } = await supabaseAdmin
		.from('profiles')
		.select('id')
		.eq('id', user.id)
		.single();

	if (!existingProfile) {
		logger.debug('[Invite Complete] Creating profile for user:', user.id);
		const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'ユーザー';

		const { error: profileError } = await supabaseAdmin.from('profiles').insert({
			id: user.id,
			full_name: fullName
		});

		if (profileError) {
			// PostgreSQLエラーコード '23505' は一意制約違反
			// 同時アクセスでプロフィールが既に作成されている場合、成功として扱う
			if (profileError.code === '23505') {
				logger.debug(
					'[Invite Complete] Profile already exists (race condition detected), continuing'
				);
			} else {
				// その他のエラーはログに記録するが、招待フローは継続
				logger.error('[Invite Complete] Error creating profile:', {
					code: profileError.code,
					message: profileError.message,
					details: profileError
				});
			}
		}
	}

	// メンバー上限チェック（招待「作成」時だけでなく「受諾」時にも強制する。
	// max_uses:null の招待や永続 invite_code が上限を超えて受諾されるのを防ぐ）
	const memberLimitCheck = await checkCanAddMember(supabaseAdmin, invitation.organization_id);
	if (!memberLimitCheck.allowed) {
		logger.warn('[Invite Complete] メンバー上限により参加拒否:', memberLimitCheck.reason);
		throw error(403, memberLimitCheck.reason || '組織のメンバー数が上限に達しています。');
	}

	// 使用権はメンバー追加より**先**に確定する。後から数えると、
	// 上限を超えた参加が成立したあとで気づくことになる。
	const claim = await claimInvitationUse(supabaseAdmin, invitation);
	if (!claim.claimed) {
		throw error(410, '招待の使用回数が上限に達しています');
	}

	// 組織メンバーとして追加（退会済みなら復帰）
	const memberResult = await joinOrRestoreMember(supabaseAdmin, {
		organizationId: invitation.organization_id,
		userId: user.id,
		role: invitation.role === 'admin' ? 'admin' : 'member'
	});

	if (!memberResult.ok) {
		if (memberResult.alreadyMember) {
			logger.debug('[Invite Complete] User is already a member, redirecting to organization');
			await releaseInvitationUse(supabaseAdmin, invitation);
			throw redirect(303, `/organization/${invitation.organization_id}`);
		}
		logger.error('[Invite Complete] Error adding member:', {
			error: memberResult.error
		});
		await releaseInvitationUse(supabaseAdmin, invitation);
		throw error(500, '組織への追加に失敗しました');
	}

	// 招待使用履歴を記録
	const { error: usageError } = await supabaseAdmin.from('invitation_uses').insert({
		invitation_id: invitation.id,
		user_id: user.id
	});

	if (usageError) {
		// PostgreSQLエラーコード '23505' は一意制約違反
		// 既に記録済みの場合、成功として扱う
		if (usageError.code === '23505') {
			logger.debug('[Invite Complete] Invitation usage already recorded (race condition detected)');
		} else {
			// その他のエラーはログに記録するが、招待フローは継続
			// 履歴記録の失敗はメンバー追加の成功を妨げるべきではない
			logger.error('[Invite Complete] Error recording invitation usage:', {
				code: usageError.code,
				message: usageError.message,
				details: usageError
			});
		}
	}

	logger.debug('[Invite Complete] Successfully added user to organization:', {
		userId: user.id,
		organizationId: invitation.organization_id,
		role: invitation.role
	});

	// 組織ページにリダイレクト
	throw redirect(303, `/organization/${invitation.organization_id}`);
};
