import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { randomBytes } from 'crypto';
import { checkCanAddMember } from '$lib/server/organizationLimits';

const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export const POST: RequestHandler = async ({ request, locals: { supabase } }) => {
	try {
		// 認証チェック
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
		const { organizationId, role = 'member', expiresInHours = 48 } = await request.json();

		// バリデーション
		if (!organizationId) {
			return json({ error: '組織IDを指定してください' }, { status: 400 });
		}

		if (!['admin', 'member'].includes(role)) {
			return json({ error: '無効な役割です' }, { status: 400 });
		}

		// ユーザーがこの組織の管理者かチェック
		const { data: membership } = await supabaseAdmin
			.from('organization_members')
			.select('role')
			.eq('organization_id', organizationId)
			.eq('user_id', user.id)
			.single();

		if (!membership || membership.role !== 'admin') {
			return json({ error: '管理者のみが招待を作成できます' }, { status: 403 });
		}

		// 組織メンバー数制限チェック
		const memberCheck = await checkCanAddMember(supabaseAdmin, organizationId);
		if (!memberCheck.allowed) {
			return json(
				{
					error: memberCheck.reason || '組織メンバー数の上限に達しています',
					upgradeUrl: memberCheck.upgradeUrl
				},
				{ status: 403 }
			);
		}

		// ユニークな招待トークンを生成
		const token = randomBytes(32).toString('hex');

		// 有効期限を設定
		const expiresAt = new Date();
		expiresAt.setHours(expiresAt.getHours() + expiresInHours);

		// 招待を作成
		const { data: invitation, error: inviteError } = await supabaseAdmin
			.from('invitations')
			.insert({
				token,
				organization_id: organizationId,
				created_by: user.id,
				role,
				expires_at: expiresAt.toISOString(),
				max_uses: null, // 無制限
				used_count: 0
			})
			.select()
			.single();

		if (inviteError) {
			console.error('Error creating invitation:', inviteError);
			return json({ error: '招待の作成に失敗しました' }, { status: 500 });
		}

		return json({
			success: true,
			invitation: {
				id: invitation.id,
				token: invitation.token,
				expires_at: invitation.expires_at
			}
		});
	} catch (error) {
		console.error('Invitation creation error:', error);
		return json({ error: '招待の作成中にエラーが発生しました' }, { status: 500 });
	}
};
