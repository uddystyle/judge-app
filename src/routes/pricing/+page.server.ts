import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	// ユーザーが認証されているか確認（任意）
	const {
		data: { user }
	} = await supabase.auth.getUser();

	// ユーザーがログインしている場合、現在のプランとプロフィールを取得
	let currentPlan = 'free';
	let profile = null;
	if (user) {
		const { data: subscription } = await supabase
			.from('subscriptions')
			.select('plan_type')
			.eq('user_id', user.id)
			.single();

		currentPlan = subscription?.plan_type || 'free';

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
		currentPlan
	};
};
