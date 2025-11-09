import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// 現在のユーザーのプロフィール情報を取得
	const { data: profile } = await supabase
		.from('profiles')
		.select('full_name')
		.eq('id', user.id)
		.single();

	// ユーザーが所属するすべての組織を取得
	const { data: memberships } = await supabase
		.from('organization_members')
		.select(
			`
			role,
			organizations (
				id,
				name,
				created_at
			)
		`
		)
		.eq('user_id', user.id);

	// 組織に所属していない場合
	if (!memberships || memberships.length === 0) {
		return {
			user,
			profile,
			organizations: []
		};
	}

	// 組織配列を作成
	const organizations = memberships.map((m: any) => ({
		...m.organizations,
		userRole: m.role
	}));

	return {
		user,
		profile,
		organizations
	};
};
