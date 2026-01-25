import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase }, url }) => {
	// URLパラメータから組織IDを取得
	const orgIdParam = url.searchParams.get('org');

	// ユーザーが認証されているか確認（任意）
	const {
		data: { user }
	} = await supabase.auth.getUser();

	// ユーザーがログインしている場合、現在のプランとプロフィールを取得
	let currentPlan = 'free';
	let currentBillingInterval: 'month' | 'year' | null = null;
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
					id,
					plan_type
				)
			`
			)
			.eq('user_id', user.id);

		// 組織に所属している場合、指定された組織または最初の組織のプランを使用
		if (memberships && memberships.length > 0) {
			organizations = memberships;

			// URLパラメータで指定された組織があれば、その組織のプランを使用
			let targetMembership = memberships[0];
			if (orgIdParam) {
				const specifiedOrg = memberships.find(m => m.organization_id === orgIdParam);
				if (specifiedOrg) {
					targetMembership = specifiedOrg;
				}
			}

			const org = targetMembership.organizations as any;
			const orgId = targetMembership.organization_id;
			currentPlan = org?.plan_type || 'free';

			// 組織のサブスクリプション情報を取得して請求間隔を確認
			if (orgId) {
				const { data: orgSubscription } = await supabase
					.from('subscriptions')
					.select('billing_interval')
					.eq('organization_id', orgId)
					.maybeSingle();

				const interval = orgSubscription?.billing_interval;
				currentBillingInterval = (interval === 'month' || interval === 'year') ? interval : null;
			}
		} else {
			// 組織に所属していない場合、個人サブスクリプションを確認
			const { data: subscription } = await supabase
				.from('subscriptions')
				.select('plan_type, billing_interval')
				.eq('user_id', user.id)
				.is('organization_id', null)
				.maybeSingle();

			currentPlan = subscription?.plan_type || 'free';
			const interval = subscription?.billing_interval;
			currentBillingInterval = (interval === 'month' || interval === 'year') ? interval : null;
		}

		// ユーザーのプロフィール情報を取得
		const { data: profileData } = await supabase
			.from('profiles')
			.select('full_name')
			.eq('id', user.id)
			.single();
		profile = profileData;
	}

	// 組織所属チェック（軽量 - カウントのみ）
	const hasOrganization = user ? organizations.length > 0 : false;

	return {
		user,
		profile,
		currentPlan,
		currentBillingInterval,
		organizations,
		hasOrganization
	};
};
