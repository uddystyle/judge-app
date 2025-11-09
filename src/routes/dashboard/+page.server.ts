import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	// レイアウトでチェック済みですが、念のための防壁として残します
	if (userError || !user) {
		throw redirect(303, '/login');
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

	// 組織IDを抽出
	const organizationIds = memberships
		? memberships
				.map((m: any) => m.organizations?.id)
				.filter((id: any) => id)
		: [];

	// セッションを並行して取得（2つのクエリを同時実行してN+1を回避）
	const [orgSessionsResult, guestSessionsResult] = await Promise.all([
		// 組織経由のセッション
		organizationIds.length > 0
			? supabase
					.from('sessions')
					.select('id, name, session_date, join_code, is_active, is_tournament_mode, mode, organization_id')
					.in('organization_id', organizationIds)
					.order('created_at', { ascending: false })
			: Promise.resolve({ data: [], error: null }),
		// ゲスト参加のセッション
		supabase
			.from('session_participants')
			.select(
				`
				session_id,
				sessions (
					id,
					name,
					session_date,
					join_code,
					is_active,
					is_tournament_mode,
					mode,
					organization_id
				)
			`
			)
			.eq('user_id', user.id)
	]);

	if (orgSessionsResult.error) {
		console.error('Error fetching org sessions:', orgSessionsResult.error);
	}
	if (guestSessionsResult.error) {
		console.error('Error fetching guest sessions:', guestSessionsResult.error);
	}

	const orgSessions = orgSessionsResult.data || [];
	const guestSessions = guestSessionsResult.data
		? guestSessionsResult.data.map((p: any) => p.sessions).filter((s: any) => s)
		: [];

	// 重複を削除してマージ（組織経由のセッションを優先）
	const sessionMap = new Map();

	// 組織セッションを先に追加
	orgSessions.forEach((s: any) => sessionMap.set(s.id, s));

	// ゲストセッションを追加（重複はスキップ）
	guestSessions.forEach((s: any) => {
		if (!sessionMap.has(s.id)) {
			sessionMap.set(s.id, s);
		}
	});

	const sessions = Array.from(sessionMap.values());

	// ユーザーのプロフィール情報を取得
	const { data: profile } = await supabase
		.from('profiles')
		.select('full_name, id')
		.eq('id', user.id)
		.single();

	// 組織配列を作成（UIが期待する形式）
	const organizations = memberships
		? memberships.map((m: any) => ({
				...m.organizations,
				userRole: m.role
		  }))
		: [];

	// 組織がない場合、オンボーディング画面へリダイレクト
	if (!organizations || organizations.length === 0) {
		throw redirect(303, '/onboarding/create-organization');
	}

	return {
		organizations,
		sessions,
		profile
	};
};
