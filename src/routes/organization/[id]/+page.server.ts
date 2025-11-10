import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, locals }) => {
	// 未ログインの場合はログインページへリダイレクト
	const {
		data: { user },
		error: userError
	} = await locals.supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}
	const organizationId = params.id;

	// 組織情報を取得
	const { data: organization, error: orgError } = await locals.supabase
		.from('organizations')
		.select('*')
		.eq('id', organizationId)
		.single();

	if (orgError || !organization) {
		throw error(404, '組織が見つかりません');
	}

	// ユーザーがこの組織のメンバーかチェック
	const { data: membership } = await locals.supabase
		.from('organization_members')
		.select('role')
		.eq('organization_id', organizationId)
		.eq('user_id', user.id)
		.single();

	if (!membership) {
		throw error(403, 'この組織にアクセスする権限がありません');
	}

	// 組織のメンバー一覧を取得
	const { data: members } = await locals.supabase
		.from('organization_members')
		.select(
			`
			id,
			role,
			joined_at,
			profiles:user_id (
				id,
				full_name,
				email
			)
		`
		)
		.eq('organization_id', organizationId)
		.order('joined_at', { ascending: true });

	// 組織の有効な招待を取得（管理者のみ）
	let invitations = [];
	if (membership.role === 'admin') {
		const { data: invitationsData } = await locals.supabase
			.from('invitations')
			.select('*')
			.eq('organization_id', organizationId)
			.gt('expires_at', new Date().toISOString())
			.order('created_at', { ascending: false });

		invitations = invitationsData || [];
	}

	// ユーザーのプロフィール情報を取得
	const { data: profile } = await locals.supabase
		.from('profiles')
		.select('full_name')
		.eq('id', user.id)
		.single();

	return {
		user,
		profile,
		organization,
		userRole: membership.role,
		members: members || [],
		invitations
	};
};
