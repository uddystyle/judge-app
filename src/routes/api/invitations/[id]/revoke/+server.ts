import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';
import { isOrgAdmin } from '$lib/server/orgAuth';
import { logger } from '$lib/server/logger';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const rateLimitResult = await checkRateLimit(request, rateLimiters?.api);
	if (!rateLimitResult.success) {
		return rateLimitResult.response;
	}

	const {
		data: { user },
		error: userError
	} = await locals.supabase.auth.getUser();

	if (userError || !user) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	if (!locals.supabaseAdmin) {
		return json({ error: 'サーバー設定が不完全です' }, { status: 500 });
	}

	const invitationId = params.id;
	const { data: invitation, error: invitationError } = await locals.supabaseAdmin
		.from('invitations')
		.select('id, organization_id, revoked_at')
		.eq('id', invitationId)
		.maybeSingle();

	if (invitationError) {
		logger.error('[Invitation Revoke] 招待取得に失敗:', invitationError);
		return json({ error: '招待の確認に失敗しました' }, { status: 500 });
	}

	if (!invitation) {
		return json({ error: '招待が見つかりません' }, { status: 404 });
	}

	if (!(await isOrgAdmin(locals.supabaseAdmin, invitation.organization_id, user.id))) {
		return json({ error: '招待を失効する権限がありません' }, { status: 403 });
	}

	if (invitation.revoked_at) {
		return json({ success: true });
	}

	const { error: updateError } = await locals.supabaseAdmin
		.from('invitations')
		.update({
			revoked_at: new Date().toISOString(),
			revoked_by: user.id
		})
		.eq('id', invitation.id);

	if (updateError) {
		logger.error('[Invitation Revoke] 招待失効に失敗:', updateError);
		return json({ error: '招待の失効に失敗しました' }, { status: 500 });
	}

	return json({ success: true });
};
