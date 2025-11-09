import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { stripe } from '$lib/server/stripe';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const organizationId = params.id;

	// ユーザーがこの組織の管理者かチェック
	const { data: membership } = await supabase
		.from('organization_members')
		.select('role, organizations(id, name, plan_type)')
		.eq('organization_id', organizationId)
		.eq('user_id', user.id)
		.single();

	if (!membership || membership.role !== 'admin') {
		throw redirect(303, '/dashboard');
	}

	// アクティブなサブスクリプション情報を取得
	const { data: activeSubscription } = await supabase
		.from('subscriptions')
		.select('id, status, current_period_end')
		.eq('organization_id', organizationId)
		.in('status', ['active', 'trialing', 'past_due'])
		.single();

	return {
		organization: membership.organizations,
		hasActiveSubscription: !!activeSubscription,
		subscriptionEndDate: activeSubscription?.current_period_end || null
	};
};

export const actions: Actions = {
	delete: async ({ params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const organizationId = params.id;

		// ユーザーがこの組織の管理者かチェック
		const { data: membership } = await supabase
			.from('organization_members')
			.select('role')
			.eq('organization_id', organizationId)
			.eq('user_id', user.id)
			.single();

		if (!membership || membership.role !== 'admin') {
			return fail(403, { error: '管理者のみが組織を削除できます。' });
		}

		// 組織に紐づくセッションの数を確認
		const { count: sessionCount } = await supabase
			.from('sessions')
			.select('*', { count: 'exact', head: true })
			.eq('organization_id', organizationId);

		if (sessionCount && sessionCount > 0) {
			return fail(400, {
				error: `この組織には${sessionCount}件のセッションが存在します。先にすべてのセッションを削除してください。`
			});
		}

		// 組織のメンバー数を確認
		const { count: memberCount } = await supabase
			.from('organization_members')
			.select('*', { count: 'exact', head: true })
			.eq('organization_id', organizationId);

		if (memberCount && memberCount > 1) {
			return fail(400, {
				error: `この組織には${memberCount}名のメンバーがいます。先にすべてのメンバーを削除してください。`
			});
		}

		// アクティブなサブスクリプションを確認してキャンセル
		const { data: subscriptions } = await supabase
			.from('subscriptions')
			.select('id, stripe_subscription_id, status')
			.eq('organization_id', organizationId)
			.in('status', ['active', 'trialing', 'past_due']);

		if (subscriptions && subscriptions.length > 0) {
			console.log(`[Organization Delete] ${subscriptions.length}件のアクティブなサブスクリプションを検出`);

			// 各サブスクリプションをキャンセル
			for (const subscription of subscriptions) {
				if (subscription.stripe_subscription_id) {
					try {
						// Stripe APIでサブスクリプションを即座にキャンセル
						const canceledSubscription = await stripe.subscriptions.cancel(
							subscription.stripe_subscription_id
						);
						console.log(
							`[Organization Delete] Stripeサブスクリプションをキャンセル: ${subscription.stripe_subscription_id}`
						);

						// データベースのステータスを更新
						await supabase
							.from('subscriptions')
							.update({
								status: 'canceled',
								cancel_at_period_end: false,
								canceled_at: new Date().toISOString()
							})
							.eq('id', subscription.id);

						console.log(
							`[Organization Delete] データベースのサブスクリプションステータスを更新: ${subscription.id}`
						);
					} catch (stripeError: any) {
						console.error(
							`[Organization Delete] Stripeサブスクリプションのキャンセルに失敗:`,
							stripeError
						);
						return fail(500, {
							error: `サブスクリプションのキャンセルに失敗しました。サポートにお問い合わせください。(${stripeError.message})`
						});
					}
				}
			}
		}

		// 組織メンバーを削除（自分自身）
		const { error: memberDeleteError } = await supabase
			.from('organization_members')
			.delete()
			.eq('organization_id', organizationId)
			.eq('user_id', user.id);

		if (memberDeleteError) {
			console.error('Failed to delete organization member:', memberDeleteError);
			return fail(500, { error: 'メンバーの削除に失敗しました。' });
		}

		// 組織を削除
		const { error: orgDeleteError } = await supabase
			.from('organizations')
			.delete()
			.eq('id', organizationId);

		if (orgDeleteError) {
			console.error('Failed to delete organization:', orgDeleteError);
			return fail(500, { error: '組織の削除に失敗しました。' });
		}

		// ダッシュボードへリダイレクト
		throw redirect(303, '/dashboard');
	}
};
