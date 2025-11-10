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

	// 組織経由のセッション
	const orgSessionsResult = organizationIds.length > 0
		? await supabase
				.from('sessions')
				.select('id, name, session_date, join_code, is_active, is_tournament_mode, mode, organization_id')
				.in('organization_id', organizationIds)
				.order('created_at', { ascending: false })
		: { data: [], error: null };

	if (orgSessionsResult.error) {
		console.error('Error fetching org sessions:', orgSessionsResult.error);
	}

	const orgSessions = orgSessionsResult.data || [];

	// ゲスト参加のセッション（2段階クエリ）
	const participantsResult = await supabase
		.from('session_participants')
		.select('session_id')
		.eq('user_id', user.id);

	let guestSessions: any[] = [];
	if (participantsResult.data && participantsResult.data.length > 0) {
		const sessionIds = participantsResult.data.map((p: any) => p.session_id);
		const sessionsResult = await supabase
			.from('sessions')
			.select('id, name, session_date, join_code, is_active, is_tournament_mode, mode, organization_id')
			.in('id', sessionIds);

		if (sessionsResult.error) {
			console.error('Error fetching guest sessions:', sessionsResult.error);
		} else {
			guestSessions = sessionsResult.data || [];
		}
	} else if (participantsResult.error) {
		console.error('Error fetching session participants:', participantsResult.error);
	}

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
		user,
		organizations,
		sessions,
		profile
	};
};
