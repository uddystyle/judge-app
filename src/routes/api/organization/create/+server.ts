import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// プランごとの検定員数制限
const MAX_MEMBERS: Record<string, number> = {
	basic: 10,
	standard: 30,
	enterprise: -1 // 無制限
};

export const POST: RequestHandler = async ({ request, locals: { supabase } }) => {
	try {
		// 認証チェック
		const {
			data: { session }
		} = await supabase.auth.getSession();

		if (!session) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const user = session.user;
		const { organizationName, planType } = await request.json();

		// バリデーション
		if (!organizationName || !organizationName.trim()) {
			return json({ error: '組織名を入力してください' }, { status: 400 });
		}

		if (!planType || !['basic', 'standard', 'enterprise'].includes(planType)) {
			return json({ error: '有効なプランを選択してください' }, { status: 400 });
		}

		// アクティブなサブスクリプションがあるかチェック
		const { data: subscription } = await supabaseAdmin
			.from('subscriptions')
			.select('*')
			.eq('user_id', user.id)
			.eq('plan_type', planType)
			.eq('status', 'active')
			.single();

		if (!subscription) {
			return json(
				{ error: '有効なサブスクリプションが見つかりません。先にプランをサブスクライブしてください。' },
				{ status: 400 }
			);
		}

		// すでに組織に紐づいているサブスクリプションでないかチェック
		if (subscription.organization_id) {
			return json(
				{ error: 'このサブスクリプションはすでに組織に紐づいています。' },
				{ status: 400 }
			);
		}

		// 組織を作成
		const { data: organization, error: orgError } = await supabaseAdmin
			.from('organizations')
			.insert({
				name: organizationName.trim(),
				plan_type: planType,
				max_members: MAX_MEMBERS[planType],
				stripe_customer_id: subscription.stripe_customer_id,
				stripe_subscription_id: subscription.stripe_subscription_id
			})
			.select()
			.single();

		if (orgError) {
			console.error('Error creating organization:', orgError);
			return json({ error: '組織の作成に失敗しました' }, { status: 500 });
		}

		// 作成者を管理者として組織に追加
		const { error: memberError } = await supabaseAdmin.from('organization_members').insert({
			organization_id: organization.id,
			user_id: user.id,
			role: 'admin'
		});

		if (memberError) {
			console.error('Error adding organization admin:', memberError);
			// 組織は作成されているので、ロールバックせずエラーを返す
			return json({ error: '組織の管理者設定に失敗しました' }, { status: 500 });
		}

		// サブスクリプションに組織IDを紐付け
		const { error: updateError } = await supabaseAdmin
			.from('subscriptions')
			.update({ organization_id: organization.id })
			.eq('id', subscription.id);

		if (updateError) {
			console.error('Error updating subscription:', updateError);
			// エラーをログに記録するが、組織は作成できているので続行
		}

		return json({
			success: true,
			organization: {
				id: organization.id,
				name: organization.name,
				plan_type: organization.plan_type
			}
		});
	} catch (error) {
		console.error('Organization creation error:', error);
		return json({ error: '組織の作成中にエラーが発生しました' }, { status: 500 });
	}
};
