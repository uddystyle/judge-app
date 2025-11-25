import type { PageServerLoad, Actions } from './$types';
import { redirect, error, fail } from '@sveltejs/kit';
import { stripe } from '$lib/server/stripe';
import {
	STRIPE_PRICE_BASIC_MONTH,
	STRIPE_PRICE_BASIC_YEAR,
	STRIPE_PRICE_STANDARD_MONTH,
	STRIPE_PRICE_STANDARD_YEAR,
	STRIPE_PRICE_PREMIUM_MONTH,
	STRIPE_PRICE_PREMIUM_YEAR
} from '$env/static/private';

export const load: PageServerLoad = async ({ params, locals: { supabase }, url }) => {
	// 1. ユーザー認証確認
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// 2. 組織情報を取得
	const { data: organization } = await supabase
		.from('organizations')
		.select('id, name, plan_type, stripe_customer_id, stripe_subscription_id')
		.eq('id', params.id)
		.single();

	if (!organization) {
		throw error(404, '組織が見つかりません。');
	}

	// 3. 管理者権限を確認
	const { data: member } = await supabase
		.from('organization_members')
		.select('role')
		.eq('organization_id', params.id)
		.eq('user_id', user.id)
		.single();

	if (!member || member.role !== 'admin') {
		throw error(403, '組織の管理者権限が必要です。');
	}

	// 4. アクティブなサブスクリプション情報を取得
	const { data: subscription } = await supabase
		.from('subscriptions')
		.select('id, status, plan_type, billing_interval, stripe_subscription_id')
		.eq('organization_id', params.id)
		.in('status', ['active', 'trialing'])
		.single();

	// サブスクリプション情報（フリープランの場合はnull）

	// 5. プラン一覧を取得
	const { data: plans } = await supabase
		.from('plan_limits')
		.select('*')
		.neq('plan_type', 'free')
		.order('max_organization_members', { ascending: true });

	// 6. ユーザーのプロフィール情報を取得
	const { data: profile } = await supabase
		.from('profiles')
		.select('id, full_name, avatar_url')
		.eq('id', user.id)
		.single();

	// 7. ユーザーが所属する組織を取得
	const { data: organizations } = await supabase
		.from('organization_members')
		.select(`
			organization_id,
			role,
			organizations (
				id,
				name,
				plan_type
			)
		`)
		.eq('user_id', user.id)
		.is('removed_at', null);

	// 組織情報を整形
	const userOrganizations = (organizations || []).map((om: any) => ({
		id: om.organizations.id,
		organization_id: om.organizations.id,
		name: om.organizations.name,
		plan_type: om.organizations.plan_type,
		role: om.role
	}));

	return {
		user,
		profile,
		organization,
		subscription,
		plans: plans || [],
		organizations: userOrganizations
	};
};

export const actions: Actions = {
	changePlan: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const newPlanType = formData.get('planType') as string;
		const billingInterval = formData.get('billingInterval') as 'month' | 'year';

		// プランタイプのバリデーション
		const validPlanTypes = ['basic', 'standard', 'premium'];
		if (!validPlanTypes.includes(newPlanType)) {
			return fail(400, { error: '無効なプランが選択されました。' });
		}

		// 組織情報を取得
		const { data: organization } = await supabase
			.from('organizations')
			.select('id, name, plan_type, stripe_subscription_id')
			.eq('id', params.id)
			.single();

		if (!organization) {
			return fail(404, { error: '組織が見つかりません。' });
		}

		// 現在のプランと同じ場合はエラー
		if (organization.plan_type === newPlanType) {
			return fail(400, { error: '既に同じプランを利用中です。' });
		}

		// フリープランからの変更の場合は、upgradeページへリダイレクト
		if (organization.plan_type === 'free') {
			throw redirect(303, `/organization/${params.id}/upgrade?plan=${newPlanType}`);
		}

		// サブスクリプション情報を取得
		const { data: subscription } = await supabase
			.from('subscriptions')
			.select('stripe_subscription_id, plan_type')
			.eq('organization_id', params.id)
			.in('status', ['active', 'trialing'])
			.single();

		if (!subscription || !subscription.stripe_subscription_id) {
			return fail(400, { error: 'アクティブなサブスクリプションが見つかりません。' });
		}

		try {
			// 新しいPrice IDを取得
			const newPriceId = getPriceId(newPlanType, billingInterval);

			if (!newPriceId) {
				return fail(400, { error: 'プランの価格情報が見つかりません。' });
			}

			// アップグレードかダウングレードかを判定
			const isUpgrade = isPlanUpgrade(organization.plan_type, newPlanType);

			console.log('[Change Plan] プラン変更開始:', {
				organizationId: organization.id,
				currentPlan: organization.plan_type,
				newPlan: newPlanType,
				isUpgrade,
				billingInterval
			});

			// Stripeサブスクリプションを取得
			const stripeSubscription = await stripe.subscriptions.retrieve(
				subscription.stripe_subscription_id
			);

			// サブスクリプションアイテムのIDを取得
			const subscriptionItemId = stripeSubscription.items.data[0].id;

			// サブスクリプションを更新
			const updatedSubscription = await stripe.subscriptions.update(
				subscription.stripe_subscription_id,
				{
					items: [
						{
							id: subscriptionItemId,
							price: newPriceId
						}
					],
					// アップグレード: 即座に請求、ダウングレード: 次回請求時
					proration_behavior: isUpgrade ? 'always_invoice' : 'none',
					billing_cycle_anchor: isUpgrade ? 'now' : 'unchanged'
				}
			);

			console.log('[Change Plan] Stripeサブスクリプション更新完了:', {
				subscriptionId: updatedSubscription.id,
				status: updatedSubscription.status
			});

			// データベースのorganizationsテーブルを更新
			const { data: planLimits } = await supabase
				.from('plan_limits')
				.select('max_organization_members')
				.eq('plan_type', newPlanType)
				.single();

			const { error: orgUpdateError } = await supabase
				.from('organizations')
				.update({
					plan_type: newPlanType,
					max_members: planLimits?.max_organization_members || 10
				})
				.eq('id', params.id);

			if (orgUpdateError) {
				console.error('[Change Plan] 組織更新エラー:', orgUpdateError);
				return fail(500, { error: '組織情報の更新に失敗しました。' });
			}

			// データベースのsubscriptionsテーブルを更新
			const { error: subUpdateError } = await supabase
				.from('subscriptions')
				.update({
					plan_type: newPlanType,
					billing_interval: billingInterval,
					status: updatedSubscription.status,
					current_period_start: new Date(
						updatedSubscription.current_period_start * 1000
					).toISOString(),
					current_period_end: new Date(
						updatedSubscription.current_period_end * 1000
					).toISOString()
				})
				.eq('stripe_subscription_id', subscription.stripe_subscription_id);

			if (subUpdateError) {
				console.error('[Change Plan] サブスクリプション更新エラー:', subUpdateError);
				return fail(500, { error: 'サブスクリプション情報の更新に失敗しました。' });
			}

			console.log('[Change Plan] プラン変更完了:', {
				organizationId: organization.id,
				newPlan: newPlanType
			});

			// 成功メッセージとともにpricingページへリダイレクト
			throw redirect(303, '/pricing?changed=true');
		} catch (err: any) {
			console.error('[Change Plan] エラー:', err);
			return fail(500, {
				error: `プラン変更に失敗しました。${err.message || ''}`
			});
		}
	}
};

/**
 * プランタイプと課金間隔からStripe Price IDを取得
 */
function getPriceId(planType: string, billingInterval: 'month' | 'year'): string | null {
	const priceMap: Record<string, Record<'month' | 'year', string>> = {
		basic: {
			month: STRIPE_PRICE_BASIC_MONTH,
			year: STRIPE_PRICE_BASIC_YEAR
		},
		standard: {
			month: STRIPE_PRICE_STANDARD_MONTH,
			year: STRIPE_PRICE_STANDARD_YEAR
		},
		premium: {
			month: STRIPE_PRICE_PREMIUM_MONTH,
			year: STRIPE_PRICE_PREMIUM_YEAR
		}
	};

	return priceMap[planType]?.[billingInterval] || null;
}

/**
 * プラン変更がアップグレードかどうかを判定
 */
function isPlanUpgrade(currentPlan: string, newPlan: string): boolean {
	const planHierarchy: Record<string, number> = {
		free: 0,
		basic: 1,
		standard: 2,
		premium: 3
	};

	return planHierarchy[newPlan] > planHierarchy[currentPlan];
}
