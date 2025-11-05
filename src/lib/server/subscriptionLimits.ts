import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ユーザーの現在のプラン制限を取得
 */
export async function getUserPlanLimits(supabase: SupabaseClient, userId: string) {
	// サブスクリプション情報を取得
	const { data: subscription } = await supabase
		.from('subscriptions')
		.select('plan_type')
		.eq('user_id', userId)
		.single();

	const planType = subscription?.plan_type || 'free';

	// プラン制限情報を取得
	const { data: planLimits, error } = await supabase
		.from('plan_limits')
		.select('*')
		.eq('plan_type', planType)
		.single();

	if (error) {
		console.error('[Plan Limits] プラン制限の取得エラー:', error);
		// デフォルトでフリープランの制限を返す
		return {
			plan_type: 'free',
			max_sessions_per_month: 3,
			max_athletes_per_session: 30,
			max_judges_per_session: 5,
			has_tournament_mode: false,
			has_training_mode: false,
			has_scoreboard: false,
			data_retention_months: 3
		};
	}

	return planLimits;
}

/**
 * 今月のセッション数をカウント
 */
export async function getCurrentMonthSessionCount(supabase: SupabaseClient, userId: string) {
	const currentMonth = new Date();
	currentMonth.setDate(1);
	currentMonth.setHours(0, 0, 0, 0);

	const { count } = await supabase
		.from('sessions')
		.select('*', { count: 'exact', head: true })
		.eq('created_by', userId)
		.gte('created_at', currentMonth.toISOString());

	return count || 0;
}

/**
 * セッション作成可否をチェック
 * @returns { allowed: boolean, reason?: string, upgradeUrl?: string }
 */
export async function checkCanCreateSession(supabase: SupabaseClient, userId: string) {
	const planLimits = await getUserPlanLimits(supabase, userId);
	const sessionCount = await getCurrentMonthSessionCount(supabase, userId);

	// 無制限の場合（-1）
	if (planLimits.max_sessions_per_month === -1) {
		return { allowed: true };
	}

	// 制限を超えている場合
	if (sessionCount >= planLimits.max_sessions_per_month) {
		return {
			allowed: false,
			reason: `今月のセッション数が上限（${planLimits.max_sessions_per_month}回）に達しました。`,
			upgradeUrl: '/pricing'
		};
	}

	return { allowed: true };
}

/**
 * 大会モード利用可否をチェック
 */
export async function checkCanUseTournamentMode(supabase: SupabaseClient, userId: string) {
	const planLimits = await getUserPlanLimits(supabase, userId);

	if (!planLimits.has_tournament_mode) {
		return {
			allowed: false,
			reason: '大会モードは有料プランでのみ利用できます。',
			upgradeUrl: '/pricing'
		};
	}

	return { allowed: true };
}

/**
 * 研修モード利用可否をチェック
 */
export async function checkCanUseTrainingMode(supabase: SupabaseClient, userId: string) {
	const planLimits = await getUserPlanLimits(supabase, userId);

	if (!planLimits.has_training_mode) {
		return {
			allowed: false,
			reason: '研修モードは有料プランでのみ利用できます。',
			upgradeUrl: '/pricing'
		};
	}

	return { allowed: true };
}

/**
 * スコアボード公開可否をチェック
 */
export async function checkCanUseScoreboard(supabase: SupabaseClient, userId: string) {
	const planLimits = await getUserPlanLimits(supabase, userId);

	if (!planLimits.has_scoreboard) {
		return {
			allowed: false,
			reason: 'スコアボード公開機能は有料プランでのみ利用できます。',
			upgradeUrl: '/pricing'
		};
	}

	return { allowed: true };
}

/**
 * セッションの選手数制限をチェック
 */
export async function checkAthleteLimit(
	supabase: SupabaseClient,
	userId: string,
	currentAthleteCount: number
) {
	const planLimits = await getUserPlanLimits(supabase, userId);

	// 無制限の場合（-1）
	if (planLimits.max_athletes_per_session === -1) {
		return { allowed: true };
	}

	// 制限を超えている場合
	if (currentAthleteCount >= planLimits.max_athletes_per_session) {
		return {
			allowed: false,
			reason: `選手数が上限（${planLimits.max_athletes_per_session}名）に達しました。`,
			upgradeUrl: '/pricing'
		};
	}

	return { allowed: true };
}

/**
 * セッションの検定員数制限をチェック
 */
export async function checkJudgeLimit(
	supabase: SupabaseClient,
	userId: string,
	currentJudgeCount: number
) {
	const planLimits = await getUserPlanLimits(supabase, userId);

	// 無制限の場合（-1）
	if (planLimits.max_judges_per_session === -1) {
		return { allowed: true };
	}

	// 制限を超えている場合
	if (currentJudgeCount >= planLimits.max_judges_per_session) {
		return {
			allowed: false,
			reason: `検定員数が上限（${planLimits.max_judges_per_session}名）に達しました。`,
			upgradeUrl: '/pricing'
		};
	}

	return { allowed: true };
}

/**
 * usage_limitsテーブルを更新（セッション作成後に呼び出す）
 */
export async function incrementSessionCount(supabase: SupabaseClient, userId: string) {
	const currentMonth = new Date();
	currentMonth.setDate(1);
	const monthStr = currentMonth.toISOString().split('T')[0];

	// 既存のレコードを取得
	const { data: existing } = await supabase
		.from('usage_limits')
		.select('*')
		.eq('user_id', userId)
		.eq('month', monthStr)
		.single();

	if (existing) {
		// 更新
		await supabase
			.from('usage_limits')
			.update({ sessions_count: existing.sessions_count + 1 })
			.eq('user_id', userId)
			.eq('month', monthStr);
	} else {
		// 新規作成
		await supabase
			.from('usage_limits')
			.insert({ user_id: userId, month: monthStr, sessions_count: 1 });
	}
}
