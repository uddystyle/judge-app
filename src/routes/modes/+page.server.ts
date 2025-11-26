import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	// 未ログインの場合はログインページへ
	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// プロフィールと組織を並列取得
	const [profileResult, membershipsResult] = await Promise.all([
		supabase.from('profiles').select('full_name, id').eq('id', user.id).single(),
		supabase
			.from('organization_members')
			.select(
				`
			role,
			organizations (
				id,
				name
			)
		`
			)
			.eq('user_id', user.id)
	]);

	const profile = profileResult.data;
	const memberships = membershipsResult.data;

	// 組織配列を作成
	const organizations = memberships
		? memberships.map((m: any) => ({
				...m.organizations,
				userRole: m.role
		  }))
		: [];

	// 組織所属チェック（軽量 - カウントのみ）
	const hasOrganization = organizations.length > 0;

	return {
		user,
		profile,
		organizations,
		hasOrganization
	};
};
