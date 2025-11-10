import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// 現在のユーザーのプロフィール情報（氏名）を取得
	const { data: profile, error: profileError } = await supabase
		.from('profiles')
		.select('full_name')
		.eq('id', user.id)
		.single();

	// プロフィールが存在しない場合は作成する
	if (profileError || !profile) {
		const { data: newProfile } = await supabase
			.from('profiles')
			.insert({
				id: user.id,
				email: user.email,
				full_name: ''
			})
			.select('full_name')
			.single();

		// 新しく作成したプロフィールを使用（作成に失敗した場合は空のオブジェクト）
		const profileData = newProfile || { full_name: '' };

		return {
			user,
			profile: profileData,
			organizations: []
		};
	}

	// ユーザーが所属するすべての組織を取得（複数組織対応）
	const { data: memberships } = await supabase
		.from('organization_members')
		.select(
			`
			role,
			organizations (
				id,
				name,
				plan_type,
				max_members,
				created_at
			)
		`
		)
		.eq('user_id', user.id);

	// 組織に所属していない場合
	if (!memberships || memberships.length === 0) {
		return {
			user,
			profile,
			organizations: []
		};
	}

	// 組織配列を作成
	const organizations = memberships.map((m: any) => ({
		...m.organizations,
		userRole: m.role
	}));

	// 今月の開始日を計算
	const currentMonth = new Date();
	currentMonth.setDate(1);
	const currentMonthISO = currentMonth.toISOString();

	// 各組織のプラン制限と使用状況を並列取得
	const organizationsWithUsage = await Promise.all(
		organizations.map(async (org: any) => {
			// 各組織の3つのクエリを並列実行
			const [planLimitsResult, sessionsCountResult, membersCountResult] = await Promise.all([
				// プラン制限情報を取得
				supabase.from('plan_limits').select('*').eq('plan_type', org.plan_type).single(),
				// 組織のセッション数をカウント
				supabase
					.from('sessions')
					.select('*', { count: 'exact', head: true })
					.eq('organization_id', org.id)
					.gte('created_at', currentMonthISO),
				// 組織のメンバー数をカウント
				supabase
					.from('organization_members')
					.select('*', { count: 'exact', head: true })
					.eq('organization_id', org.id)
			]);

			return {
				...org,
				planLimits: planLimitsResult.data,
				currentUsage: {
					sessions_count: sessionsCountResult.count || 0,
					members_count: membersCountResult.count || 0
				}
			};
		})
	);

	// 取得したプロフィール情報と組織情報をページに渡す
	return {
		user,
		profile,
		organizations: organizationsWithUsage
	};
};
