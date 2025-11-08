import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
	const session = await locals.supabase.auth.getSession();

	// 未ログインの場合はログインページへリダイレクト
	if (!session.data.session) {
		throw redirect(303, '/login');
	}

	const user = session.data.session.user;

	// ユーザーのアクティブなサブスクリプション情報を取得
	const { data: subscription } = await locals.supabase
		.from('subscriptions')
		.select('*')
		.eq('user_id', user.id)
		.eq('status', 'active')
		.in('plan_type', ['basic', 'standard', 'premium'])
		.order('created_at', { ascending: false })
		.limit(1)
		.single();

	// ユーザーのプロフィール情報を取得
	const { data: profile } = await locals.supabase
		.from('profiles')
		.select('full_name')
		.eq('id', user.id)
		.single();

	return {
		user,
		profile,
		subscription
	};
};
