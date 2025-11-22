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

	// ユーザーのプロフィールと組織を並列取得
	const [profileResult, membershipsResult] = await Promise.all([
		supabase.from('profiles').select('full_name, id').eq('id', user.id).single(),
		supabase
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
			.eq('user_id', user.id)
	]);

	const profile = profileResult.data;
	const memberships = membershipsResult.data;

	// 組織IDを抽出
	const organizationIds = memberships
		? memberships
				.map((m: any) => m.organizations?.id)
				.filter((id: any) => id)
		: [];

	// 組織経由のセッションとゲスト参加セッションを並列取得（約100-200ms短縮）
	const [orgSessionsResult, guestSessionsResult] = await Promise.all([
		// 組織経由のセッション（最新100件に制限）
		organizationIds.length > 0
			? supabase
					.from('sessions')
					.select('id, name, session_date, join_code, is_active, is_tournament_mode, mode, organization_id, exclude_extremes, is_multi_judge')
					.in('organization_id', organizationIds)
					.order('created_at', { ascending: false })
					.limit(100)
			: Promise.resolve({ data: [], error: null }),
		// ゲスト参加のセッション（JOINで一度に取得）
		supabase
			.from('session_participants')
			.select(`
				session_id,
				sessions!inner (
					id,
					name,
					session_date,
					join_code,
					is_active,
					is_tournament_mode,
					mode,
					organization_id,
					exclude_extremes,
					is_multi_judge
				)
			`)
			.eq('user_id', user.id)
			.limit(100)
	]);

	if (orgSessionsResult.error) {
		console.error('Error fetching org sessions:', orgSessionsResult.error);
	}

	if (guestSessionsResult.error) {
		console.error('Error fetching guest sessions:', guestSessionsResult.error);
	}

	const orgSessions = orgSessionsResult.data || [];

	// ゲストセッションをフラット化
	const guestSessions = guestSessionsResult.data
		? guestSessionsResult.data.map((p: any) => p.sessions).filter(Boolean)
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

	// 各セッションの検定員数と研修設定を取得（N+1問題を解決）
	const sessionIds = sessions.map((s: any) => s.id);

	// 全セッションの参加者と研修設定を並列取得（1回のクエリで取得）
	const [allParticipantsResult, trainingSettingsResult] = await Promise.all([
		sessionIds.length > 0
			? supabase.from('session_participants').select('session_id').in('session_id', sessionIds)
			: Promise.resolve({ data: [], error: null }),
		sessionIds.length > 0
			? supabase
					.from('training_sessions')
					.select('session_id, is_multi_judge')
					.in('session_id', sessionIds)
			: Promise.resolve({ data: [], error: null })
	]);

	// 参加者数をセッションIDごとにカウント
	const participantCountMap = new Map();
	if (allParticipantsResult.data) {
		allParticipantsResult.data.forEach((p: any) => {
			participantCountMap.set(p.session_id, (participantCountMap.get(p.session_id) || 0) + 1);
		});
	}

	// 研修設定をマップ化
	const trainingSettingsMap = new Map();
	if (trainingSettingsResult.data) {
		trainingSettingsResult.data.forEach((t: any) => {
			trainingSettingsMap.set(t.session_id, t.is_multi_judge);
		});
	}

	// セッションにデータをマージ（DBクエリなし）
	const sessionsWithParticipantCount = sessions.map((session: any) => ({
		...session,
		participantCount: participantCountMap.get(session.id) || 0,
		// 研修モードは training_sessions から、それ以外は sessions.is_multi_judge を使用
		isMultiJudge: session.mode === 'training'
			? (trainingSettingsMap.get(session.id) ?? false)
			: (session.is_multi_judge ?? false)
	}));

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
		sessions: sessionsWithParticipantCount,
		profile
	};
};
