import type { PageServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	// 1. ユーザー認証確認
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// 2. 組織情報を取得
	const { data: organization } = await supabase
		.from('organizations')
		.select('id, name, plan_type')
		.eq('id', params.id)
		.single();

	if (!organization) {
		throw error(404, '組織が見つかりません。');
	}

	// 3. 管理者権限を確認
	const { data: member } = await supabase
		.from('organization_members')
		.select('role')
		.eq('organization_id', params.id)
		.eq('user_id', user.id)
		.single();

	if (!member || member.role !== 'admin') {
		throw error(403, '組織の管理者権限が必要です。');
	}

	// 4. フリープランかどうか確認
	if (organization.plan_type !== 'free') {
		throw redirect(303, '/account');
	}

	// 5. プロフィール情報を取得
	const { data: profile } = await supabase
		.from('profiles')
		.select('id, full_name, avatar_url')
		.eq('id', user.id)
		.single();

	return {
		user,
		profile,
		organization
	};
};
