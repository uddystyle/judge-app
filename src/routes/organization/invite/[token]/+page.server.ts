import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { token } = params;

	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	// 招待情報を取得
	const { data: invitation, error: invitationError } = await supabase
		.from('invitations')
		.select(`
			id,
			organization_id,
			role,
			expires_at,
			max_uses,
			used_count,
			organizations (
				id,
				name
			)
		`)
		.eq('token', token)
		.single();

	if (invitationError || !invitation) {
		throw error(404, '招待が見つかりません。');
	}

	// 有効期限チェック
	const now = new Date();
	const expiresAt = new Date(invitation.expires_at);
	if (expiresAt < now) {
		throw error(410, 'この招待は有効期限切れです。');
	}

	// 使用制限チェック
	if (invitation.max_uses !== null && invitation.used_count >= invitation.max_uses) {
		throw error(410, 'この招待は使用回数の上限に達しています。');
	}

	// 未ログインの場合はログインページへ（招待トークンを保持）
	if (userError || !user) {
		throw redirect(303, `/login?redirect=/organization/invite/${token}`);
	}

	// 既にメンバーかどうかチェック
	const { data: existingMember } = await supabase
		.from('organization_members')
		.select('id, role')
		.eq('organization_id', invitation.organization_id)
		.eq('user_id', user.id)
		.maybeSingle();

	if (existingMember) {
		// 既にメンバーの場合はダッシュボードへ
		throw redirect(303, '/dashboard');
	}

	// 組織にメンバーとして追加
	const { error: joinError } = await supabase.from('organization_members').insert({
		organization_id: invitation.organization_id,
		user_id: user.id,
		role: invitation.role
	});

	if (joinError) {
		console.error('Failed to join organization:', joinError);
		throw error(500, '組織への参加に失敗しました。');
	}

	// 招待の使用回数を更新
	await supabase
		.from('invitations')
		.update({ used_count: invitation.used_count + 1 })
		.eq('id', invitation.id);

	// 使用履歴を記録
	await supabase.from('invitation_uses').insert({
		invitation_id: invitation.id,
		user_id: user.id
	});

	// ダッシュボードへリダイレクト
	throw redirect(303, '/dashboard');
};
