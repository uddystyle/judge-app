import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// プロフィール情報を取得
	const { data: profile } = await supabase
		.from('profiles')
		.select('full_name, id')
		.eq('id', user.id)
		.single();

	// 組織メンバーシップ情報を取得
	const { data: memberships } = await supabase
		.from('organization_members')
		.select('role, organizations (id, name)')
		.eq('user_id', user.id);

	const organizations = memberships
		? memberships.map((m: any) => ({
				...m.organizations,
				userRole: m.role
		  }))
		: [];

	return { user, profile, organizations };
};

export const actions: Actions = {
	join: async ({ request, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const joinCode = (formData.get('joinCode') as string)?.trim().toUpperCase();

		// バリデーション
		if (!joinCode) {
			return fail(400, { joinCode: '', error: '招待コードを入力してください。' });
		}

		if (joinCode.length !== 6) {
			return fail(400, { joinCode, error: '招待コードは6桁です。' });
		}

		// 英数字のみ許可
		if (!/^[A-Z0-9]{6}$/.test(joinCode)) {
			return fail(400, { joinCode, error: '招待コードは英数字6桁で入力してください。' });
		}

		// 招待コードに一致する組織をデータベースから検索
		const { data: organizationData, error: organizationError } = await supabase
			.from('organizations')
			.select('id, name')
			.eq('invite_code', joinCode)
			.single();

		if (organizationError || !organizationData) {
			return fail(404, { joinCode, error: '無効な招待コードです。' });
		}

		// 既にメンバーかどうかチェック
		const { data: existingMember } = await supabase
			.from('organization_members')
			.select('id')
			.eq('organization_id', organizationData.id)
			.eq('user_id', user.id)
			.maybeSingle();

		if (existingMember) {
			return fail(400, { joinCode, error: '既にこの組織のメンバーです。' });
		}

		// 組織にメンバーとして追加
		const { error: joinError } = await supabase.from('organization_members').insert({
			organization_id: organizationData.id,
			user_id: user.id,
			role: 'member'
		});

		if (joinError) {
			console.error('Failed to join organization:', joinError);
			return fail(500, {
				joinCode,
				error: 'サーバーエラー: 組織への参加に失敗しました。'
			});
		}

		// 成功したら、ダッシュボードへリダイレクト
		throw redirect(303, '/dashboard');
	}
};
