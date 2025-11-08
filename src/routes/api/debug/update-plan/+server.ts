import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export const POST: RequestHandler = async ({ request, locals: { supabase } }) => {
	// 認証確認
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw error(401, '認証が必要です。');
	}

	try {
		const { organizationId, planType } = await request.json();

		if (!organizationId || !planType) {
			throw error(400, '必須パラメータが不足しています。');
		}

		if (!['basic', 'standard', 'premium'].includes(planType)) {
			throw error(400, '無効なプランタイプです。');
		}

		// 組織の管理者権限を確認
		const { data: member } = await supabase
			.from('organization_members')
			.select('role')
			.eq('organization_id', organizationId)
			.eq('user_id', user.id)
			.single();

		if (!member || member.role !== 'admin') {
			throw error(403, '組織の管理者権限が必要です。');
		}

		// プランごとのmax_membersを設定
		const maxMembers: Record<string, number> = {
			basic: 10,
			standard: 30,
			premium: 100
		};

		// 組織のプランを更新
		const { error: updateError } = await supabaseAdmin
			.from('organizations')
			.update({
				plan_type: planType,
				max_members: maxMembers[planType]
			})
			.eq('id', organizationId);

		if (updateError) {
			console.error('組織更新エラー:', updateError);
			throw error(500, '組織の更新に失敗しました。');
		}

		console.log(`[DEBUG] 組織 ${organizationId} のプランを ${planType} に更新しました`);

		return json({ success: true, message: 'プランを更新しました' });
	} catch (err: any) {
		console.error('[DEBUG Update Plan] エラー:', err);
		throw error(500, err.message || 'プランの更新に失敗しました。');
	}
};
