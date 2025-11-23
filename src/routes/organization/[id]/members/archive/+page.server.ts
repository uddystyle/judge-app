import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { id: orgId } = params;

	// ユーザー認証チェック
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// 組織情報を取得
	const { data: organization, error: orgError } = await supabase
		.from('organizations')
		.select('id, name, plan_type')
		.eq('id', orgId)
		.single();

	if (orgError || !organization) {
		throw error(404, '組織が見つかりません');
	}

	// ユーザーがこの組織の管理者かチェック
	const { data: membership, error: membershipError } = await supabase
		.from('organization_members')
		.select('role')
		.eq('organization_id', orgId)
		.eq('user_id', user.id)
		.is('removed_at', null)
		.single();

	if (membershipError || !membership) {
		throw error(403, '組織にアクセスする権限がありません');
	}

	if (membership.role !== 'admin') {
		throw error(403, '管理者のみメンバーアーカイブにアクセスできます');
	}

	// 削除されたメンバーを取得
	const { data: removedMembers, error: membersError } = await supabase
		.from('organization_members')
		.select('id, user_id, role, joined_at, removed_at, removed_by')
		.eq('organization_id', orgId)
		.not('removed_at', 'is', null)
		.order('removed_at', { ascending: false });

	if (membersError) {
		console.error('Error fetching removed members:', membersError);
		throw error(500, '削除されたメンバーの取得に失敗しました');
	}

	// メンバーのuser_idリストを取得
	const memberUserIds = [...new Set((removedMembers || []).map((m) => m.user_id).filter(Boolean))];

	// 削除者のuser_idリストを取得
	const removerUserIds = [
		...new Set((removedMembers || []).map((m) => m.removed_by).filter(Boolean))
	];

	// 全てのユニークなuser_idを結合
	const allUserIds = [...new Set([...memberUserIds, ...removerUserIds])];

	// プロフィール情報を一括取得
	const { data: profiles } =
		allUserIds.length > 0
			? await supabase.from('profiles').select('id, full_name').in('id', allUserIds)
			: { data: [] };

	// プロフィールをマップ化
	const profileMap = new Map();
	(profiles || []).forEach((profile: any) => {
		profileMap.set(profile.id, profile);
	});

	// メンバーにプロフィール情報を追加
	const membersWithProfiles = (removedMembers || []).map((member) => ({
		...member,
		profile: member.user_id ? profileMap.get(member.user_id) : null,
		removed_by_profile: member.removed_by ? profileMap.get(member.removed_by) : null
	}));

	// プロフィール情報を取得
	const { data: profile } = await supabase
		.from('profiles')
		.select('full_name, id')
		.eq('id', user.id)
		.single();

	return {
		user,
		profile,
		organization,
		removedMembers: membersWithProfiles,
		userRole: membership.role
	};
};
