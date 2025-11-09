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
		.select('role, organizations(id, name, plan_type, stripe_customer_id, stripe_subscription_id)')
		.eq('organization_id', organizationId)
		.eq('user_id', user.id)
		.single();

	if (!membership || membership.role !== 'admin') {
		throw redirect(303, '/dashboard');
	}

	const organization = membership.organizations;

	// アクティブなサブスクリプション情報を取得
	let hasActiveSubscription = false;
	let subscriptionEndDate: string | null = null;

	// 1. データベースのsubscriptionsテーブルから確認
	const { data: dbSubscription } = await supabase
		.from('subscriptions')
		.select('id, status, current_period_end')
		.eq('organization_id', organizationId)
		.in('status', ['active', 'trialing', 'past_due'])
		.single();

	if (dbSubscription) {
		hasActiveSubscription = true;
		subscriptionEndDate = dbSubscription.current_period_end;
	}

	// 2. データベースに無い場合、Stripe APIで直接確認
	if (!hasActiveSubscription) {
		// 組織テーブルのstripe_subscription_idを確認
		if (organization?.stripe_subscription_id) {
			try {
				const subscription = await stripe.subscriptions.retrieve(
					organization.stripe_subscription_id
				);
				if (['active', 'trialing', 'past_due'].includes(subscription.status)) {
					hasActiveSubscription = true;
					subscriptionEndDate = new Date(subscription.current_period_end * 1000).toISOString();
				}
			} catch (error) {
				console.error('[Load] stripe_subscription_id検証エラー:', error);
			}
		}

		// stripe_customer_idから全サブスクリプションを確認
		if (!hasActiveSubscription && organization?.stripe_customer_id) {
			try {
				const subscriptions = await stripe.subscriptions.list({
					customer: organization.stripe_customer_id,
					status: 'all',
					limit: 10
				});

				for (const sub of subscriptions.data) {
					if (['active', 'trialing', 'past_due'].includes(sub.status)) {
						hasActiveSubscription = true;
						subscriptionEndDate = new Date(sub.current_period_end * 1000).toISOString();
						break;
					}
				}
			} catch (error) {
				console.error('[Load] stripe_customer_id検証エラー:', error);
			}
		}
	}

	return {
		organization,
		hasActiveSubscription,
		subscriptionEndDate
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

		// 組織情報を取得（Stripe顧客IDとサブスクリプションIDを含む）
		const { data: organization } = await supabase
			.from('organizations')
			.select('stripe_customer_id, stripe_subscription_id')
			.eq('id', organizationId)
			.single();

		// Stripeサブスクリプションをキャンセル
		const subscriptionsToCancel: string[] = [];

		// 1. データベースのsubscriptionsテーブルから検索
		const { data: dbSubscriptions } = await supabase
			.from('subscriptions')
			.select('id, stripe_subscription_id, status')
			.eq('organization_id', organizationId)
			.in('status', ['active', 'trialing', 'past_due']);

		if (dbSubscriptions && dbSubscriptions.length > 0) {
			for (const sub of dbSubscriptions) {
				if (sub.stripe_subscription_id) {
					subscriptionsToCancel.push(sub.stripe_subscription_id);
				}
			}
		}

		// 2. 組織テーブルのstripe_subscription_idも確認
		if (organization?.stripe_subscription_id) {
			if (!subscriptionsToCancel.includes(organization.stripe_subscription_id)) {
				subscriptionsToCancel.push(organization.stripe_subscription_id);
			}
		}

		// 3. Stripe APIで顧客に紐づくすべてのサブスクリプションを取得
		if (organization?.stripe_customer_id) {
			try {
				const stripeSubscriptions = await stripe.subscriptions.list({
					customer: organization.stripe_customer_id,
					status: 'all'
				});

				for (const stripeSub of stripeSubscriptions.data) {
					// アクティブまたはトライアル中のサブスクリプションのみキャンセル対象
					if (
						['active', 'trialing', 'past_due'].includes(stripeSub.status) &&
						!subscriptionsToCancel.includes(stripeSub.id)
					) {
						subscriptionsToCancel.push(stripeSub.id);
					}
				}
			} catch (stripeError: any) {
				console.error(
					`[Organization Delete] Stripe顧客のサブスクリプション取得に失敗:`,
					stripeError
				);
			}
		}

		// 見つかったすべてのサブスクリプションをキャンセル
		if (subscriptionsToCancel.length > 0) {
			console.log(
				`[Organization Delete] ${subscriptionsToCancel.length}件のサブスクリプションをキャンセル`
			);

			for (const subscriptionId of subscriptionsToCancel) {
				try {
					// Stripe APIでサブスクリプションを即座にキャンセル
					await stripe.subscriptions.cancel(subscriptionId);
					console.log(
						`[Organization Delete] Stripeサブスクリプションをキャンセル: ${subscriptionId}`
					);

					// データベースのステータスを更新（存在する場合）
					await supabase
						.from('subscriptions')
						.update({
							status: 'canceled',
							cancel_at_period_end: false,
							canceled_at: new Date().toISOString()
						})
						.eq('stripe_subscription_id', subscriptionId);

					console.log(
						`[Organization Delete] データベースのサブスクリプションステータスを更新: ${subscriptionId}`
					);
				} catch (stripeError: any) {
					console.error(
						`[Organization Delete] Stripeサブスクリプションのキャンセルに失敗:`,
						stripeError
					);
					// リソースが見つからない場合はスキップ（既にキャンセルされている）
					if (stripeError.code !== 'resource_missing') {
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
