import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	// ユーザーが認証されているか確認（任意）
	const {
		data: { user }
	} = await supabase.auth.getUser();

	// ユーザーがログインしている場合、現在のプランとプロフィールを取得
	let currentPlan = 'free';
	let profile = null;
	let organizations: any[] = [];
	if (user) {
		// ユーザーが所属する組織を取得
		const { data: memberships } = await supabase
			.from('organization_members')
			.select(
				`
				organization_id,
				organizations!inner (
					plan_type
				)
			`
			)
			.eq('user_id', user.id);

		// 組織に所属している場合、最初の組織のプランを使用
		if (memberships && memberships.length > 0) {
			const org = memberships[0].organizations as any;
			currentPlan = org?.plan_type || 'free';
			organizations = memberships;
		} else {
			// 組織に所属していない場合、個人サブスクリプションを確認
			const { data: subscription } = await supabase
				.from('subscriptions')
				.select('plan_type')
				.eq('user_id', user.id)
				.single();

			currentPlan = subscription?.plan_type || 'free';
		}

		// ユーザーのプロフィール情報を取得
		const { data: profileData } = await supabase
			.from('profiles')
			.select('full_name')
			.eq('id', user.id)
			.single();
		profile = profileData;
	}

	return {
		user,
		profile,
		currentPlan,
		organizations
	};
};
