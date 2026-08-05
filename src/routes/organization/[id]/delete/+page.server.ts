import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { stripe } from '$lib/server/stripe';
import { getSubscriptionPeriod } from '$lib/server/stripeTypes';
import { isOrgAdmin } from '$lib/server/orgAuth';
import { logger } from '$lib/server/logger';

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
	if (!(await isOrgAdmin(supabase, organizationId, user.id))) {
		throw redirect(303, '/dashboard');
	}

	const { data: organization } = await supabase
		.from('organizations')
		.select('id, name, plan_type, stripe_customer_id, stripe_subscription_id')
		.eq('id', organizationId)
		.single();

	if (!organization) {
		throw redirect(303, '/dashboard');
	}

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
					// 期間は API バージョン差分を吸収して取得（clover では items 側にのみ存在する）
					const period = getSubscriptionPeriod(subscription);
					subscriptionEndDate = period ? new Date(period.end * 1000).toISOString() : null;
				}
			} catch (error) {
				logger.error('[Load] stripe_subscription_id検証エラー:', error);
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
						// 期間は API バージョン差分を吸収して取得（clover では items 側にのみ存在する）
						const period = getSubscriptionPeriod(sub);
						subscriptionEndDate = period ? new Date(period.end * 1000).toISOString() : null;
						break;
					}
				}
			} catch (error) {
				logger.error('[Load] stripe_customer_id検証エラー:', error);
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
	delete: async ({ params, locals: { supabase, supabaseAdmin } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const organizationId = params.id;

		// ユーザーがこの組織の管理者かチェック
		if (!(await isOrgAdmin(supabase, organizationId, user.id))) {
			return fail(403, { error: '組織を削除する権限がありません。' });
		}

		// P1-C: subscriptions への書き込みは service role で行う（SEC-3 と同じ方針）。
		//
		// ⚠️ subscriptions は RLS 有効で **UPDATE / DELETE ポリシーが1本も無い**。
		// user client で書くと PostgREST は権限で弾かれた更新を
		// **エラーではなく「0行」として返す**ため、`error` は null のままになり、
		// コードは成功したと判断して先へ進む（＝Stripe は解約済みなのに DB に
		// status='active' の孤児行が残る）。2026-03-10 に change-plan で起きた障害と
		// まったく同じ失敗の形で、その時は change-plan だけを直したため
		// この削除経路が取り残されていた。
		if (!supabaseAdmin) {
			logger.error('[Organization Delete] supabaseAdminが未設定です');
			return fail(500, { error: 'サーバー設定エラーが発生しました。管理者に連絡してください。' });
		}

		// 組織に紐づくセッションの数を確認
		const { count: sessionCount } = await supabase
			.from('sessions')
			.select('*', { count: 'exact', head: true })
			.eq('organization_id', organizationId)
			.is('removed_at', null);

		if (sessionCount && sessionCount > 0) {
			return fail(400, {
				error: `この組織には${sessionCount}件のセッションが存在します。先にすべてのセッションを削除してください。`
			});
		}

		// 組織のメンバー数を確認（退会済みは数えない）
		const { count: memberCount } = await supabase
			.from('organization_members')
			.select('*', { count: 'exact', head: true })
			.eq('organization_id', organizationId)
			.is('removed_at', null);

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
		//    読み取りも service role で行う（SELECT ポリシーが契約者本人限定のため、
		//    契約者以外の管理者が削除すると解約対象を取りこぼす）
		const { data: dbSubscriptions } = await supabaseAdmin
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
				logger.error(
					`[Organization Delete] Stripe顧客のサブスクリプション取得に失敗:`,
					stripeError
				);
			}
		}

		// 見つかったすべてのサブスクリプションをキャンセル
		if (subscriptionsToCancel.length > 0) {
			logger.debug(
				`[Organization Delete] ${subscriptionsToCancel.length}件のサブスクリプションをキャンセル`
			);

			for (const subscriptionId of subscriptionsToCancel) {
				try {
					// Stripe APIでサブスクリプションを即座にキャンセル
					await stripe.subscriptions.cancel(subscriptionId);
					logger.debug(
						`[Organization Delete] Stripeサブスクリプションをキャンセル: ${subscriptionId}`
					);

					// データベースのステータスを更新（存在する場合）
					await supabaseAdmin
						.from('subscriptions')
						.update({
							status: 'canceled',
							cancel_at_period_end: false,
							canceled_at: new Date().toISOString()
						})
						.eq('stripe_subscription_id', subscriptionId);

					logger.debug(
						`[Organization Delete] データベースのサブスクリプションステータスを更新: ${subscriptionId}`
					);
				} catch (stripeError: any) {
					logger.error(
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

		// subscriptionsテーブルのレコードを削除（service role: 上のコメント参照）
		const { error: subscriptionDeleteError } = await supabaseAdmin
			.from('subscriptions')
			.delete()
			.eq('organization_id', organizationId);

		if (subscriptionDeleteError) {
			logger.error('Failed to delete subscriptions:', subscriptionDeleteError);
			return fail(500, { error: 'サブスクリプション情報の削除に失敗しました。' });
		}

		logger.debug('[Organization Delete] subscriptionsレコードを削除');

		// 組織メンバーを削除（自分自身）
		const { error: memberDeleteError } = await supabase
			.from('organization_members')
			.delete()
			.eq('organization_id', organizationId)
			.eq('user_id', user.id);

		if (memberDeleteError) {
			logger.error('Failed to delete organization member:', memberDeleteError);
			return fail(500, { error: 'メンバーの削除に失敗しました。' });
		}

		// 組織を削除
		const { error: orgDeleteError } = await supabase
			.from('organizations')
			.delete()
			.eq('id', organizationId);

		if (orgDeleteError) {
			// 大会チケット（請求監査データ）を持つ組織は FK restrict で削除不可（migration 1022）
			if (orgDeleteError.message?.includes('tournament_tickets')) {
				return fail(400, {
					error:
						'大会チケットのご利用履歴がある組織のため、削除にはお手続きが必要です。お問い合わせください。'
				});
			}
			logger.error('Failed to delete organization:', orgDeleteError);
			return fail(500, { error: '組織の削除に失敗しました。' });
		}

		// ダッシュボードへリダイレクト
		throw redirect(303, '/dashboard');
	}
};
