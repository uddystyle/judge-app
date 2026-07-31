import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '$lib/server/logger';

/**
 * 組織の現在のプラン制限を取得
 */
export async function getOrganizationPlanLimits(supabase: SupabaseClient, organizationId: string) {
	// 組織のプランタイプを取得
	const { data: organization } = await supabase
		.from('organizations')
		.select('plan_type')
		.eq('id', organizationId)
		.single();

	if (!organization) {
		logger.error('[Organization Limits] 組織が見つかりません:', organizationId);
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
		logger.error('[Organization Limits] プラン制限の取得エラー:', error);
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
 * 大会セッションはチケット（スポット販売）で対価を得ているため、
 * 月間セッション数の上限からは除外する。
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
		.is('deleted_at', null) // 削除済みセッションを除外
		.or('mode.is.null,mode.neq.tournament') // 大会はチケット制のため月間上限の対象外（mode 未設定の旧行は数える）
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

	// 2. 現在のメンバー数を取得（削除済みメンバーを除外）
	const { count } = await supabase
		.from('organization_members')
		.select('*', { count: 'exact', head: true })
		.eq('organization_id', organizationId)
		.is('removed_at', null); // 退会済みメンバーを除外

	const currentMemberCount = count || 0;

	// 3. 制限チェック（無制限の場合は -1）
	if (
		limits.max_organization_members !== -1 &&
		currentMemberCount >= limits.max_organization_members
	) {
		return {
			allowed: false,
			reason: `組織メンバー数の上限（${limits.max_organization_members}人）に達しています。`,
			upgradeUrl: `/organization/${organizationId}/change-plan`
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
			upgradeUrl: `/organization/${organizationId}/change-plan`
		};
	}

	return { allowed: true };
}

// 大会モードのプランゲート（checkCanUseTournamentMode）は廃止した。
// 大会はプラン特典ではなくチケット制（スポット販売）になり、
// 判定は $lib/server/tournamentTickets.ts + DB トリガー（migration 1022）が担う。

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
			upgradeUrl: `/organization/${organizationId}/change-plan`
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
	logger.debug('[checkCanAddJudgeToSession] チェック開始:', { sessionId });

	// 1. セッションの組織とプランを取得
	const { data: session, error: sessionError } = await supabase
		.from('sessions')
		.select('organization_id, is_tournament_mode')
		.eq('id', sessionId)
		.maybeSingle();

	logger.debug('[checkCanAddJudgeToSession] セッション取得結果:', { session, error: sessionError });

	if (sessionError) {
		logger.error('[checkCanAddJudgeToSession] セッション取得エラー:', sessionError);
		return {
			allowed: false,
			reason: `セッション情報の取得に失敗しました。${sessionError.message || ''}`
		};
	}

	if (!session) {
		logger.debug('[checkCanAddJudgeToSession] セッションが見つかりません');
		return {
			allowed: false,
			reason: 'セッション情報の取得に失敗しました。'
		};
	}

	logger.debug('[checkCanAddJudgeToSession] 組織ID:', session.organization_id);

	// 大会セッションはチケット（スポット販売）で対価を得ており、
	// 規模もチケット価格に織り込む商品設計のため、プランの検定員数上限を適用しない
	if (session.is_tournament_mode) {
		logger.debug('[checkCanAddJudgeToSession] 大会セッションのため検定員数上限を免除');
		return { allowed: true };
	}

	// 2. プラン制限を取得
	const limits = await getOrganizationPlanLimits(supabase, session.organization_id);
	logger.debug('[checkCanAddJudgeToSession] プラン制限:', limits);

	if (!limits) {
		logger.error('[checkCanAddJudgeToSession] プラン制限の取得に失敗');
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
	logger.debug('[checkCanAddJudgeToSession] 現在の検定員数:', currentJudgeCount);
	logger.debug('[checkCanAddJudgeToSession] 上限:', limits.max_judges_per_session);

	// 4. 制限チェック（無制限の場合は -1）
	if (limits.max_judges_per_session !== -1 && currentJudgeCount >= limits.max_judges_per_session) {
		logger.debug('[checkCanAddJudgeToSession] 検定員数上限に達している');
		return {
			allowed: false,
			reason: `セッションの検定員数上限（${limits.max_judges_per_session}人）に達しています。`,
			upgradeUrl: `/organization/${session.organization_id}/change-plan`
		};
	}

	logger.debug('[checkCanAddJudgeToSession] チェック完了: 参加可能');
	return { allowed: true };
}

// checkCanUseScoreboard（呼び出しゼロのデッドコード）は削除した。
// スコアボード公開は大会モードの一機能としてチケットに含まれる。
