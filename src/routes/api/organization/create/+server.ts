import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// プランごとの組織メンバー数制限
const MAX_MEMBERS: Record<string, number> = {
	basic: 10,
	standard: 30,
	premium: 100
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

		if (!planType || !['basic', 'standard', 'premium'].includes(planType)) {
			return json({ error: '有効なプランを選択してください' }, { status: 400 });
		}

		// アクティブなサブスクリプションがあるかチェック
		const { data: subscription } = await supabaseAdmin
			.from('subscriptions')
			.select('*')
			.eq('user_id', user.id)
			.eq('plan_type', planType)
			.eq('status', 'active')
			.is('organization_id', null)
			.single();

		if (!subscription) {
			return json(
				{ error: '有効なサブスクリプションが見つかりません。先にプランをサブスクライブしてください。' },
				{ status: 400 }
			);
		}

		console.log('[Organization Create API] Creating organization with transaction');
		console.log('[Organization Create API] User:', user.id);
		console.log('[Organization Create API] Organization:', organizationName.trim());
		console.log('[Organization Create API] Plan:', planType);
		console.log('[Organization Create API] Subscription:', subscription.id);

		// トランザクション処理を使用して組織を作成
		// Postgres関数により、組織作成・メンバー追加・サブスクリプション更新が原子的に実行される
		const { data: result, error: rpcError } = await supabaseAdmin.rpc(
			'create_organization_with_subscription',
			{
				p_user_id: user.id,
				p_organization_name: organizationName.trim(),
				p_plan_type: planType,
				p_max_members: MAX_MEMBERS[planType],
				p_subscription_id: subscription.id
			}
		);

		if (rpcError) {
			console.error('[Organization Create API] RPC Error:', rpcError);
			console.error('[Organization Create API] Error details:', JSON.stringify(rpcError, null, 2));
			return json({ error: '組織の作成に失敗しました' }, { status: 500 });
		}

		if (result.already_exists) {
			console.log('[Organization Create API] Organization already exists (idempotent):', result.organization_id);
		} else {
			console.log('[Organization Create API] Organization created successfully:', result.organization_id);
		}

		return json({
			success: true,
			organization: {
				id: result.organization_id,
				name: result.organization_name,
				plan_type: result.plan_type
			}
		});
	} catch (error) {
		console.error('Organization creation error:', error);
		return json({ error: '組織の作成中にエラーが発生しました' }, { status: 500 });
	}
};
