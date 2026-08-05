import type { PageServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { isOrgAdmin } from '$lib/server/orgAuth';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ params, locals: { supabase, supabaseAdmin } }) => {
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
		.select('id, name, plan_type, stripe_customer_id')
		.eq('id', params.id)
		.single();

	if (!organization) {
		throw error(404, '組織が見つかりません。');
	}

	logger.debug('[Upgrade Page Load] 組織情報:', {
		id: organization.id,
		name: organization.name,
		plan_type: organization.plan_type,
		stripe_customer_id: organization.stripe_customer_id
	});

	// 3. 管理者権限を確認（orgAuth 経由で退会済みメンバーを除外。
	//    以前はこのページだけ removed_at フィルタが欠けていた）
	if (!(await isOrgAdmin(supabase, params.id, user.id))) {
		throw error(403, '組織の管理者権限が必要です。');
	}

	// 4. 既に有料プランに登録済みかどうか確認
	//
	// ⚠️ 読み取りは service role で行う。subscriptions の SELECT ポリシーは
	// `auth.uid() = user_id`（＝checkout を開始した本人）だけなので、user client だと
	// **契約者以外の管理者には契約が「無い」ように見え、このガードが素通りする**。
	// 素通りすると2本目のサブスクリプションが作られ、webhook が旧サブスクを
	// 日割り返金なしで解約するため前払い分が失効する。
	// 本命の防御は API 側（/api/stripe/upgrade-organization）にあるが、
	// 画面の表示もそれと食い違わないようにする。
	const { data: subscription } = await (supabaseAdmin ?? supabase)
		.from('subscriptions')
		.select('id, status')
		.eq('organization_id', params.id)
		.in('status', ['active', 'trialing'])
		.maybeSingle();

	if (subscription) {
		logger.debug(
			'[Upgrade Page Load] 既にアクティブなサブスクリプションがあります。/accountにリダイレクト'
		);
		throw redirect(303, '/account');
	}

	// 5. プロフィール情報を取得
	const { data: profile } = await supabase
		.from('profiles')
		.select('id, full_name, avatar_url')
		.eq('id', user.id)
		.single();

	return {
		user,
		profile,
		organization,
		hasOrganization: true
	};
};
