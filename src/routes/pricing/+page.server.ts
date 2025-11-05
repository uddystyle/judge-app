import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	// ユーザーが認証されているか確認（任意）
	const {
		data: { user }
	} = await supabase.auth.getUser();

	// ユーザーがログインしている場合、現在のプランを取得
	let currentPlan = 'free';
	if (user) {
		const { data: subscription } = await supabase
			.from('subscriptions')
			.select('plan_type')
			.eq('user_id', user.id)
			.single();

		currentPlan = subscription?.plan_type || 'free';
	}

	return {
		user,
		currentPlan
	};
};
