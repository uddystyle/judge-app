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

	// 現在のユーザーのプロフィール情報（氏名）を取得
	const { data: profile } = await supabase
		.from('profiles')
		.select('full_name')
		.eq('id', user.id)
		.single();

	// サブスクリプション情報を取得
	const { data: subscription } = await supabase
		.from('subscriptions')
		.select('*')
		.eq('user_id', user.id)
		.single();

	// プラン制限情報を取得
	const planType = subscription?.plan_type || 'free';
	const { data: planLimits } = await supabase
		.from('plan_limits')
		.select('*')
		.eq('plan_type', planType)
		.single();

	// 今月の使用状況を取得
	const currentMonth = new Date();
	currentMonth.setDate(1);
	const monthStr = currentMonth.toISOString().split('T')[0];

	const { data: usage } = await supabase
		.from('usage_limits')
		.select('sessions_count')
		.eq('user_id', user.id)
		.eq('month', monthStr)
		.single();

	// 今月のセッション数をカウント（usage_limitsがない場合は直接カウント）
	const { count: sessionsCount } = await supabase
		.from('sessions')
		.select('*', { count: 'exact', head: true })
		.eq('created_by', user.id)
		.gte('created_at', currentMonth.toISOString());

	// 取得したプロフィール情報とサブスクリプション情報をページに渡す
	return {
		profile,
		subscription: subscription || {
			plan_type: 'free',
			billing_interval: 'month',
			status: 'active'
		},
		planLimits,
		currentUsage: {
			sessions_count: usage?.sessions_count || sessionsCount || 0
		}
	};
};
