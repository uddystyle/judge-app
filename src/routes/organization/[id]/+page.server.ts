import type { PageServerLoad, Actions } from './$types';
import { error, redirect, fail } from '@sveltejs/kit';
import { validateOrganizationName } from '$lib/server/validation';

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
	const { data: membership } = await locals.supabase
		.from('organization_members')
		.select('role')
		.eq('organization_id', organizationId)
		.eq('user_id', user.id)
		.is('removed_at', null)
		.single();

	if (!membership) {
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
		console.error('Error fetching memberships:', membershipsError);
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
			console.error('Error fetching profiles:', profilesError);
		} else {
			// メンバーシップとプロフィールを結合
			members = membershipsData.map((membership: any) => ({
				id: membership.id,
				role: membership.role,
				joined_at: membership.joined_at,
				profiles: profilesData?.find((p: any) => p.id === membership.user_id) || null
			}));
		}
	}

	// 組織の有効な招待を取得（管理者のみ）
	let invitations = [];
	if (membership.role === 'admin') {
		const { data: invitationsData } = await locals.supabase
			.from('invitations')
			.select('*')
			.eq('organization_id', organizationId)
			.gt('expires_at', new Date().toISOString())
			.order('created_at', { ascending: false });

		invitations = invitationsData || [];
	}

	// ユーザーのプロフィール情報を取得
	const { data: profile } = await locals.supabase
		.from('profiles')
		.select('full_name')
		.eq('id', user.id)
		.single();

	return {
		user,
		profile,
		organization,
		userRole: membership.role,
		members: members || [],
		invitations
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
		const { data: membership } = await supabase
			.from('organization_members')
			.select('role')
			.eq('organization_id', organizationId)
			.eq('user_id', user.id)
			.is('removed_at', null)
			.single();

		if (!membership || membership.role !== 'admin') {
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
			console.error('Organization name update error:', updateError);
			return fail(500, {
				error: '組織名の更新に失敗しました。しばらくしてから再度お試しください。',
				name: nameRaw
			});
		}

		return { success: true, message: '組織名を更新しました。' };
	}
} satisfies Actions;
