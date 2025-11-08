import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

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
	const { data: membership } = await supabase
		.from('organization_members')
		.select('role, organizations(id, name, plan_type)')
		.eq('organization_id', organizationId)
		.eq('user_id', user.id)
		.single();

	if (!membership || membership.role !== 'admin') {
		throw redirect(303, '/dashboard');
	}

	return {
		organization: membership.organizations
	};
};

export const actions: Actions = {
	delete: async ({ params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const organizationId = params.id;

		// ユーザーがこの組織の管理者かチェック
		const { data: membership } = await supabase
			.from('organization_members')
			.select('role')
			.eq('organization_id', organizationId)
			.eq('user_id', user.id)
			.single();

		if (!membership || membership.role !== 'admin') {
			return fail(403, { error: '管理者のみが組織を削除できます。' });
		}

		// 組織に紐づくセッションの数を確認
		const { count: sessionCount } = await supabase
			.from('sessions')
			.select('*', { count: 'exact', head: true })
			.eq('organization_id', organizationId);

		if (sessionCount && sessionCount > 0) {
			return fail(400, {
				error: `この組織には${sessionCount}件のセッションが存在します。先にすべてのセッションを削除してください。`
			});
		}

		// 組織のメンバー数を確認
		const { count: memberCount } = await supabase
			.from('organization_members')
			.select('*', { count: 'exact', head: true })
			.eq('organization_id', organizationId);

		if (memberCount && memberCount > 1) {
			return fail(400, {
				error: `この組織には${memberCount}名のメンバーがいます。先にすべてのメンバーを削除してください。`
			});
		}

		// 組織メンバーを削除（自分自身）
		const { error: memberDeleteError } = await supabase
			.from('organization_members')
			.delete()
			.eq('organization_id', organizationId)
			.eq('user_id', user.id);

		if (memberDeleteError) {
			console.error('Failed to delete organization member:', memberDeleteError);
			return fail(500, { error: 'メンバーの削除に失敗しました。' });
		}

		// 組織を削除
		const { error: orgDeleteError } = await supabase
			.from('organizations')
			.delete()
			.eq('id', organizationId);

		if (orgDeleteError) {
			console.error('Failed to delete organization:', orgDeleteError);
			return fail(500, { error: '組織の削除に失敗しました。' });
		}

		// ダッシュボードへリダイレクト
		throw redirect(303, '/dashboard');
	}
};
