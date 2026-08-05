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
			.eq('user_id', user.id)
			.is('removed_at', null);

		// 組織に所属している場合、指定された組織または最初の組織のプランを使用
		if (memberships && memberships.length > 0) {
			organizations = memberships;

			// URLパラメータで指定された組織があれば、その組織のプランを使用
			let targetMembership = memberships[0];
			if (orgIdParam) {
				const specifiedOrg = memberships.find((m) => m.organization_id === orgIdParam);
				if (specifiedOrg) {
					targetMembership = specifiedOrg;
				}
			}

			const org = targetMembership.organizations as any;
			const orgId = targetMembership.organization_id;
			currentPlan = org?.plan_type || 'free';

			// 組織のサブスクリプション情報を取得して請求間隔を確認
			if (orgId) {
				// ⚠️ 1組織 = 1行を前提にしないこと。再契約すると解約済みの履歴が
				// organization_id を保持したまま残り、複数行になる。
				// PostgREST の maybeSingle() は複数行でもエラーになるため、前提を置くと
				// 履歴が増えた瞬間に請求間隔の表示が黙って既定へ戻る
				// （organization/[id]/+page.server.ts に同じ罠の記録あり）。
				// migration 1035 で組織管理者が組織の全契約行を読めるようになったため、
				// 「契約者本人の行しか見えないので実質1行」という以前の偶然の防御は消えている。
				const { data: orgSubscription } = await supabase
					.from('subscriptions')
					.select('billing_interval')
					.eq('organization_id', orgId)
					.order('created_at', { ascending: false })
					.limit(1)
					.maybeSingle();

				const interval = orgSubscription?.billing_interval;
				currentBillingInterval = interval === 'month' || interval === 'year' ? interval : null;
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
			currentBillingInterval = interval === 'month' || interval === 'year' ? interval : null;
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
