import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { checkCanAddMember } from '$lib/server/organizationLimits';
import { logger } from '$lib/server/logger';
import { joinOrRestoreMember } from '$lib/server/orgMembership';

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
		.eq('user_id', user.id)
		.is('removed_at', null);

	const organizations = memberships
		? memberships.map((m: any) => ({
				...m.organizations,
				userRole: m.role
			}))
		: [];

	// 組織所属チェック（軽量 - カウントのみ）
	const hasOrganization = organizations.length > 0;

	return { user, profile, organizations, hasOrganization };
};

export const actions: Actions = {
	join: async ({ request, locals: { supabase, supabaseAdmin } }) => {
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

		// 招待コードに一致する組織を検索。参加前で呼び出し元はまだ非メンバーのため、
		// organizations の member スコープ RLS（1016）では anon/authed で読めない。service role で照合する。
		if (!supabaseAdmin) {
			logger.error('[Org Join] supabaseAdmin が利用できません（SUPABASE_SERVICE_ROLE_KEY 未設定）');
			return fail(500, {
				joinCode,
				error: 'サーバー設定エラーにより参加できませんでした。管理者に連絡してください。'
			});
		}
		const { data: organizationData, error: organizationError } = await supabaseAdmin
			.from('organizations')
			.select('id, name')
			.eq('invite_code', joinCode)
			.single();

		if (organizationError || !organizationData) {
			return fail(404, { joinCode, error: '無効な招待コードです。' });
		}

		// 在籍中かどうかのチェック。退会済み（removed_at あり）はここで弾かず、
		// 下の joinOrRestoreMember が復帰として扱う（再参加を許可する）。
		const { data: existingMember } = await supabase
			.from('organization_members')
			.select('id')
			.eq('organization_id', organizationData.id)
			.eq('user_id', user.id)
			.is('removed_at', null)
			.maybeSingle();

		if (existingMember) {
			return fail(400, { joinCode, error: '既にこの組織のメンバーです。' });
		}

		// メンバー上限チェック（受諾時に強制）。参加者本人はまだ非メンバーで RLS により
		// 正確なメンバー数を取得できないため、service role で集計する
		const memberLimitCheck = await checkCanAddMember(
			supabaseAdmin ?? supabase,
			organizationData.id
		);
		if (!memberLimitCheck.allowed) {
			return fail(403, {
				joinCode,
				error: memberLimitCheck.reason || '組織のメンバー数が上限に達しています。',
				upgradeUrl: memberLimitCheck.upgradeUrl
			});
		}

		// 組織にメンバーとして追加（退会済みなら復帰）。
		// UNIQUE (organization_id, user_id) があるため単純な INSERT では
		// 再参加が一意制約違反になる。復帰時の role は 'member' に戻す。
		const joinResult = await joinOrRestoreMember(supabaseAdmin, {
			organizationId: organizationData.id,
			userId: user.id,
			role: 'member'
		});

		if (!joinResult.ok) {
			if (joinResult.alreadyMember) {
				return fail(400, { joinCode, error: '既にこの組織のメンバーです。' });
			}
			return fail(500, {
				joinCode,
				error: 'サーバーエラー: 組織への参加に失敗しました。'
			});
		}

		// 成功したら、ダッシュボードへリダイレクト
		throw redirect(303, '/dashboard');
	}
};
