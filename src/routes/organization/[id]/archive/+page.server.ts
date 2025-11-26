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

	// プラン情報を別途取得
	const { data: planData, error: planError } = await supabase
		.from('plans')
		.select('archived_data_retention_days')
		.eq('plan_type', organization.plan_type)
		.single();

	// 組織データにプラン情報を追加
	organization.plans = planData;

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
		throw error(403, '管理者のみアーカイブにアクセスできます');
	}

	// 削除されたセッションを取得
	const { data: archivedSessions, error: sessionsError } = await supabase
		.from('sessions')
		.select('id, name, session_date, deleted_at, deleted_by, mode, is_tournament_mode')
		.eq('organization_id', orgId)
		.not('deleted_at', 'is', null)
		.order('deleted_at', { ascending: false });

	if (sessionsError) {
		console.error('Error fetching archived sessions:', sessionsError);
		throw error(500, 'アーカイブセッションの取得に失敗しました');
	}

	// 削除者のプロフィール情報を取得
	const deletedByUserIds = [
		...new Set((archivedSessions || []).map((s) => s.deleted_by).filter(Boolean))
	];

	const { data: deletedByProfiles } =
		deletedByUserIds.length > 0
			? await supabase.from('profiles').select('id, full_name').in('id', deletedByUserIds)
			: { data: [] };

	// プロフィールをマップ化
	const profileMap = new Map();
	(deletedByProfiles || []).forEach((profile: any) => {
		profileMap.set(profile.id, profile);
	});

	// セッションにプロフィール情報を追加
	const sessionsWithProfiles = (archivedSessions || []).map((session) => ({
		...session,
		deleted_by_profile: session.deleted_by ? profileMap.get(session.deleted_by) : null
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
		archivedSessions: sessionsWithProfiles,
		userRole: membership.role
	,
		hasOrganization: true
	};
};
