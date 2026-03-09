import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * メールアドレスを正規化（小文字化 + トリム）
 * 大文字小文字の違いや前後の空白を吸収し、比較の一貫性を保つ
 */
function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const token = params.token;

	console.log('[Invite Complete] Loading invitation completion with token:', token);

	// 認証チェック
	const {
		data: { user },
		error: userError
	} = await locals.supabase.auth.getUser();

	if (userError || !user) {
		console.error('[Invite Complete] User not authenticated');
		throw redirect(303, `/login?next=/invite/${token}/complete`);
	}

	console.log('[Invite Complete] User authenticated:', {
		userId: user.id,
		email: user.email,
		emailConfirmedAt: user.email_confirmed_at
	});

	// メール確認済みかチェック
	if (!user.email_confirmed_at) {
		console.warn('[Invite Complete] Email not confirmed yet');
		throw redirect(303, `/invite/${token}/check-email`);
	}

	// 招待情報を取得
	const { data: invitation, error: inviteError } = await supabaseAdmin
		.from('invitations')
		.select('*, organizations(*)')
		.eq('token', token)
		.single();

	if (inviteError || !invitation) {
		console.error('[Invite Complete] Error fetching invitation:', inviteError);
		throw error(404, '招待が見つかりません');
	}

	// 有効期限チェック
	if (new Date(invitation.expires_at) < new Date()) {
		throw error(410, '招待の有効期限が切れています');
	}

	// 使用制限チェック
	if (invitation.max_uses !== null && invitation.used_count >= invitation.max_uses) {
		throw error(410, '招待の使用回数が上限に達しています');
	}

	// 招待メールが指定されている場合、ユーザーのメールアドレスと一致するかチェック
	// 正規化して比較することで、大文字小文字の違いや空白による回避を防ぐ
	if (invitation.email && user.email && normalizeEmail(invitation.email) !== normalizeEmail(user.email)) {
		console.error('[Invite Complete] Email mismatch:', {
			invitationEmail: invitation.email,
			userEmail: user.email,
			normalizedInvitation: normalizeEmail(invitation.email),
			normalizedUser: normalizeEmail(user.email)
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
		console.log('[Invite Complete] User is already a member, redirecting to organization');
		throw redirect(303, `/organization/${invitation.organization_id}`);
	}

	// プロフィールが存在するかチェック（存在しない場合は作成）
	const { data: existingProfile } = await supabaseAdmin
		.from('profiles')
		.select('id')
		.eq('id', user.id)
		.single();

	if (!existingProfile) {
		console.log('[Invite Complete] Creating profile for user:', user.id);
		const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'ユーザー';

		const { error: profileError } = await supabaseAdmin.from('profiles').insert({
			id: user.id,
			email: user.email!,
			full_name: fullName
		});

		if (profileError) {
			// PostgreSQLエラーコード '23505' は一意制約違反
			// 同時アクセスでプロフィールが既に作成されている場合、成功として扱う
			if (profileError.code === '23505') {
				console.log('[Invite Complete] Profile already exists (race condition detected), continuing');
			} else {
				// その他のエラーはログに記録するが、招待フローは継続
				console.error('[Invite Complete] Error creating profile:', {
					code: profileError.code,
					message: profileError.message,
					details: profileError
				});
			}
		}
	}

	// 組織メンバーとして追加
	const { error: memberError } = await supabaseAdmin.from('organization_members').insert({
		organization_id: invitation.organization_id,
		user_id: user.id,
		role: invitation.role
	});

	if (memberError) {
		// PostgreSQLエラーコード '23505' は一意制約違反（UNIQUE constraint violation）
		// 同時アクセスでexistingMembershipチェック後にinsertが競合した場合に発生
		// この場合、既に参加済みとして成功扱いし、組織ページにリダイレクト
		if (memberError.code === '23505') {
			console.log('[Invite Complete] User is already a member (race condition detected), redirecting to organization');
			throw redirect(303, `/organization/${invitation.organization_id}`);
		}

		// その他の予期しないエラー
		console.error('[Invite Complete] Error adding member:', {
			code: memberError.code,
			message: memberError.message,
			details: memberError
		});
		throw error(500, '組織への追加に失敗しました');
	}

	// 招待の使用回数を更新
	await supabaseAdmin
		.from('invitations')
		.update({ used_count: invitation.used_count + 1 })
		.eq('id', invitation.id);

	// 招待使用履歴を記録
	const { error: usageError } = await supabaseAdmin.from('invitation_uses').insert({
		invitation_id: invitation.id,
		user_id: user.id
	});

	if (usageError) {
		// PostgreSQLエラーコード '23505' は一意制約違反
		// 既に記録済みの場合、成功として扱う
		if (usageError.code === '23505') {
			console.log('[Invite Complete] Invitation usage already recorded (race condition detected)');
		} else {
			// その他のエラーはログに記録するが、招待フローは継続
			// 履歴記録の失敗はメンバー追加の成功を妨げるべきではない
			console.error('[Invite Complete] Error recording invitation usage:', {
				code: usageError.code,
				message: usageError.message,
				details: usageError
			});
		}
	}

	console.log('[Invite Complete] Successfully added user to organization:', {
		userId: user.id,
		organizationId: invitation.organization_id,
		role: invitation.role
	});

	// 組織ページにリダイレクト
	throw redirect(303, `/organization/${invitation.organization_id}`);
};
