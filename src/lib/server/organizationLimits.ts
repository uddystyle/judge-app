import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 組織の現在のプラン制限を取得
 */
export async function getOrganizationPlanLimits(
	supabase: SupabaseClient,
	organizationId: string
) {
	// 組織のプランタイプを取得
	const { data: organization } = await supabase
		.from('organizations')
		.select('plan_type')
		.eq('id', organizationId)
		.single();

	if (!organization) {
		console.error('[Organization Limits] 組織が見つかりません:', organizationId);
		return null;
	}

	const planType = organization.plan_type || 'free';

	// プラン制限情報を取得
	const { data: planLimits, error } = await supabase
		.from('plan_limits')
		.select('*')
		.eq('plan_type', planType)
		.single();

	if (error) {
		console.error('[Organization Limits] プラン制限の取得エラー:', error);
		// デフォルトでフリープランの制限を返す
		return {
			plan_type: 'free',
			max_sessions_per_month: 3,
			max_athletes_per_session: -1,
			max_judges_per_session: 3,
			max_organization_members: 1,
			has_tournament_mode: false,
			has_training_mode: false,
			has_scoreboard: false,
			data_retention_months: 3
		};
	}

	return planLimits;
}

/**
 * 今月の組織のセッション数をカウント
 */
export async function getCurrentMonthSessionCount(
	supabase: SupabaseClient,
	organizationId: string
) {
	const currentMonth = new Date();
	currentMonth.setDate(1);
	currentMonth.setHours(0, 0, 0, 0);

	const { count } = await supabase
		.from('sessions')
		.select('*', { count: 'exact', head: true })
		.eq('organization_id', organizationId)
		.gte('created_at', currentMonth.toISOString());

	return count || 0;
}

/**
 * 組織メンバー数制限チェック
 */
export async function checkCanAddMember(
	supabase: SupabaseClient,
	organizationId: string
): Promise<{ allowed: boolean; reason?: string; upgradeUrl?: string }> {
	// 1. 組織のプラン制限を取得
	const limits = await getOrganizationPlanLimits(supabase, organizationId);
	if (!limits) {
		return {
			allowed: false,
			reason: '組織情報の取得に失敗しました。'
		};
	}

	// 2. 現在のメンバー数を取得
	const { count } = await supabase
		.from('organization_members')
		.select('*', { count: 'exact', head: true })
		.eq('organization_id', organizationId);

	const currentMemberCount = count || 0;

	// 3. 制限チェック（無制限の場合は -1）
	if (limits.max_organization_members !== -1 && currentMemberCount >= limits.max_organization_members) {
		return {
			allowed: false,
			reason: `組織メンバー数の上限（${limits.max_organization_members}人）に達しています。`,
			upgradeUrl: '/settings/billing'
		};
	}

	return { allowed: true };
}

/**
 * セッション作成可否をチェック（組織ベース）
 */
export async function checkCanCreateSession(
	supabase: SupabaseClient,
	organizationId: string
): Promise<{ allowed: boolean; reason?: string; upgradeUrl?: string }> {
	const planLimits = await getOrganizationPlanLimits(supabase, organizationId);
	if (!planLimits) {
		return {
			allowed: false,
			reason: '組織情報の取得に失敗しました。'
		};
	}

	const sessionCount = await getCurrentMonthSessionCount(supabase, organizationId);

	// 無制限の場合（-1）
	if (planLimits.max_sessions_per_month === -1) {
		return { allowed: true };
	}

	// 制限を超えている場合
	if (sessionCount >= planLimits.max_sessions_per_month) {
		return {
			allowed: false,
			reason: `今月のセッション数が上限（${planLimits.max_sessions_per_month}回）に達しました。`,
			upgradeUrl: '/settings/billing'
		};
	}

	return { allowed: true };
}

/**
 * 大会モード利用可否をチェック（組織ベース）
 */
export async function checkCanUseTournamentMode(
	supabase: SupabaseClient,
	organizationId: string
): Promise<{ allowed: boolean; reason?: string; upgradeUrl?: string }> {
	const planLimits = await getOrganizationPlanLimits(supabase, organizationId);
	if (!planLimits) {
		return {
			allowed: false,
			reason: '組織情報の取得に失敗しました。'
		};
	}

	if (!planLimits.has_tournament_mode) {
		return {
			allowed: false,
			reason: '大会モードは有料プランでのみ利用できます。',
			upgradeUrl: '/settings/billing'
		};
	}

	return { allowed: true };
}

/**
 * 研修モード利用可否をチェック（組織ベース）
 */
export async function checkCanUseTrainingMode(
	supabase: SupabaseClient,
	organizationId: string
): Promise<{ allowed: boolean; reason?: string; upgradeUrl?: string }> {
	const planLimits = await getOrganizationPlanLimits(supabase, organizationId);
	if (!planLimits) {
		return {
			allowed: false,
			reason: '組織情報の取得に失敗しました。'
		};
	}

	if (!planLimits.has_training_mode) {
		return {
			allowed: false,
			reason: '研修モードは有料プランでのみ利用できます。',
			upgradeUrl: '/settings/billing'
		};
	}

	return { allowed: true };
}

/**
 * セッション検定員数制限チェック
 */
export async function checkCanAddJudgeToSession(
	supabase: SupabaseClient,
	sessionId: string
): Promise<{ allowed: boolean; reason?: string; upgradeUrl?: string }> {
	console.log('[checkCanAddJudgeToSession] チェック開始:', { sessionId });

	// 1. セッションの組織とプランを取得
	const { data: session, error: sessionError } = await supabase
		.from('sessions')
		.select('organization_id')
		.eq('id', sessionId)
		.maybeSingle();

	console.log('[checkCanAddJudgeToSession] セッション取得結果:', { session, error: sessionError });

	if (sessionError) {
		console.error('[checkCanAddJudgeToSession] セッション取得エラー:', sessionError);
		return {
			allowed: false,
			reason: `セッション情報の取得に失敗しました。${sessionError.message || ''}`
		};
	}

	if (!session) {
		console.log('[checkCanAddJudgeToSession] セッションが見つかりません');
		return {
			allowed: false,
			reason: 'セッション情報の取得に失敗しました。'
		};
	}

	console.log('[checkCanAddJudgeToSession] 組織ID:', session.organization_id);

	// 2. プラン制限を取得
	const limits = await getOrganizationPlanLimits(supabase, session.organization_id);
	console.log('[checkCanAddJudgeToSession] プラン制限:', limits);

	if (!limits) {
		console.error('[checkCanAddJudgeToSession] プラン制限の取得に失敗');
		return {
			allowed: false,
			reason: '組織情報の取得に失敗しました。'
		};
	}

	// 3. 現在の検定員数を取得
	const { count } = await supabase
		.from('session_participants')
		.select('*', { count: 'exact', head: true })
		.eq('session_id', sessionId);

	const currentJudgeCount = count || 0;
	console.log('[checkCanAddJudgeToSession] 現在の検定員数:', currentJudgeCount);
	console.log('[checkCanAddJudgeToSession] 上限:', limits.max_judges_per_session);

	// 4. 制限チェック（無制限の場合は -1）
	if (limits.max_judges_per_session !== -1 && currentJudgeCount >= limits.max_judges_per_session) {
		console.log('[checkCanAddJudgeToSession] 検定員数上限に達している');
		return {
			allowed: false,
			reason: `セッションの検定員数上限（${limits.max_judges_per_session}人）に達しています。`,
			upgradeUrl: '/settings/billing'
		};
	}

	console.log('[checkCanAddJudgeToSession] チェック完了: 参加可能');
	return { allowed: true };
}

/**
 * スコアボード公開可否をチェック（組織ベース）
 */
export async function checkCanUseScoreboard(
	supabase: SupabaseClient,
	organizationId: string
): Promise<{ allowed: boolean; reason?: string; upgradeUrl?: string }> {
	const planLimits = await getOrganizationPlanLimits(supabase, organizationId);
	if (!planLimits) {
		return {
			allowed: false,
			reason: '組織情報の取得に失敗しました。'
		};
	}

	if (!planLimits.has_scoreboard) {
		return {
			allowed: false,
			reason: 'スコアボード公開機能は有料プランでのみ利用できます。',
			upgradeUrl: '/settings/billing'
		};
	}

	return { allowed: true };
}
