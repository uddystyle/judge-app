import type { PageServerLoad, Actions } from './$types';
import { error, redirect, fail } from '@sveltejs/kit';
import { validateOrganizationName } from '$lib/server/validation';
import { getActiveOrgRole, isOrgAdmin } from '$lib/server/orgAuth';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ params, locals }) => {
	// 未ログインの場合はログインページへリダイレクト
	const {
		data: { user },
		error: userError
	} = await locals.supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}
	const organizationId = params.id;

	// 組織情報を取得
	const { data: organization, error: orgError } = await locals.supabase
		.from('organizations')
		.select('*')
		.eq('id', organizationId)
		.single();

	if (orgError || !organization) {
		throw error(404, '組織が見つかりません');
	}

	// ユーザーがこの組織のメンバーかチェック（アクティブなメンバーのみ）
	const userRole = await getActiveOrgRole(locals.supabase, organizationId, user.id);

	if (!userRole) {
		throw error(403, '組織にアクセスする権限がありません。');
	}

	// 組織のアクティブなメンバー一覧を取得（2段階クエリ）
	const { data: membershipsData, error: membershipsError } = await locals.supabase
		.from('organization_members')
		.select('id, role, joined_at, user_id')
		.eq('organization_id', organizationId)
		.is('removed_at', null)
		.order('joined_at', { ascending: true });

	if (membershipsError) {
		logger.error('Error fetching memberships:', membershipsError);
	}

	// メンバーのプロフィール情報を取得
	let members: any[] = [];
	if (membershipsData && membershipsData.length > 0) {
		const userIds = membershipsData.map((m: any) => m.user_id);
		const { data: profilesData, error: profilesError } = await locals.supabase
			.from('profiles')
			.select('id, full_name')
			.in('id', userIds);

		if (profilesError) {
			logger.error('Error fetching profiles:', profilesError);
		} else {
			// メンバーシップとプロフィールを結合
			members = membershipsData.map((membership: any) => ({
				id: membership.id,
				user_id: membership.user_id,
				role: membership.role,
				joined_at: membership.joined_at,
				profiles: profilesData?.find((p: any) => p.id === membership.user_id) || null
			}));
		}
	}

	// 組織の有効な招待を取得（管理者のみ）
	let invitations: Array<{
		id: string;
		role: string;
		email: string | null;
		expires_at: string;
		max_uses: number | null;
		used_count: number;
		created_at: string;
		revoked_at: string | null;
	}> = [];
	if (userRole === 'admin') {
		const { data: invitationsData } = await locals.supabase
			.from('invitations')
			.select('id, role, email, expires_at, max_uses, used_count, created_at, revoked_at')
			.eq('organization_id', organizationId)
			.is('revoked_at', null)
			.gt('expires_at', new Date().toISOString())
			.order('created_at', { ascending: false });

		invitations = (invitationsData || []).filter(
			(invitation: any) =>
				invitation.max_uses === null || invitation.used_count < invitation.max_uses
		);
	}

	// ユーザーのプロフィール情報を取得
	const { data: profile } = await locals.supabase
		.from('profiles')
		.select('full_name')
		.eq('id', user.id)
		.single();

	// 組織所属チェック（このページは既に組織ページなので常にtrue）
	const hasOrganization = true;

	// 課金状態（status / 解約予定）を管理者にだけ付与する。
	//
	// ⚠️ subscriptions の SELECT ポリシーは `auth.uid() = user_id` なので、契約者本人以外の
	// 管理者はユーザークライアントでは読めない。上で role を確認済みなので service role で引く。
	// 一般メンバーには渡さない。支払い方法を直せる立場になく、見せる必要も無いため。
	let billing: {
		status: string;
		cancelAtPeriodEnd: boolean;
		currentPeriodEnd: string | null;
	} | null = null;

	if (userRole === 'admin' && locals.supabaseAdmin) {
		// ⚠️ 1組織 = 1行を前提にしないこと。再契約すると解約済みの履歴が残り複数行になる。
		// PostgREST の maybeSingle() は複数行でもエラーになるため、前提を置くと
		// 履歴が増えた瞬間にバッジが黙って消える（H-1 と同じ罠）。新しい1件に絞ってから取る。
		const { data: sub, error: subError } = await locals.supabaseAdmin
			.from('subscriptions')
			.select('status, cancel_at_period_end, current_period_end')
			.eq('organization_id', organizationId)
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();

		if (subError) {
			// 課金状態が出せなくても組織ページ自体は表示する
			logger.error('[Organization] サブスクリプション状態の取得に失敗:', subError);
		} else if (sub) {
			billing = {
				status: sub.status,
				cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
				currentPeriodEnd: sub.current_period_end ?? null
			};
		}
	}

	return {
		user,
		profile,
		organization,
		userRole,
		members: members || [],
		invitations,
		hasOrganization,
		billing
	};
};

export const actions = {
	updateName: async ({ request, params, locals }) => {
		const { supabase } = locals;
		const organizationId = params.id;

		// 未ログインの場合
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: 'ログインが必要です。' });
		}

		// ユーザーがこの組織の管理者かチェック（アクティブなメンバーのみ）
		if (!(await isOrgAdmin(supabase, organizationId, user.id))) {
			return fail(403, { error: '組織名を変更する権限がありません。' });
		}

		const formData = await request.formData();
		const nameRaw = formData.get('name') as string;

		// バリデーション
		const nameValidation = validateOrganizationName(nameRaw);
		if (!nameValidation.valid) {
			return fail(400, {
				error: nameValidation.error || '組織名が無効です。',
				name: nameRaw
			});
		}

		const name = nameValidation.sanitized || '';

		// 組織名を更新
		const { error: updateError } = await supabase
			.from('organizations')
			.update({ name, updated_at: new Date().toISOString() })
			.eq('id', organizationId);

		if (updateError) {
			logger.error('Organization name update error:', updateError);
			return fail(500, {
				error: '組織名の更新に失敗しました。しばらくしてから再度お試しください。',
				name: nameRaw
			});
		}

		return { success: true, message: '組織名を更新しました。' };
	}
} satisfies Actions;
