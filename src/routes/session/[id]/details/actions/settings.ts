import { fail, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { logger } from '$lib/server/logger';

// セッション設定アクション（details ページ）。挙動は page.server.actions.test.ts で固定。

export const updateTrainingSettings = async ({
	request,
	params,
	locals: { supabase }
}: RequestEvent) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const formData = await request.formData();
	const isMultiJudge = formData.get('isMultiJudge') === 'true';

	logger.debug('[updateTrainingSettings] ========== 研修設定更新 ==========');
	logger.debug('[updateTrainingSettings] sessionId:', params.id);
	logger.debug('[updateTrainingSettings] isMultiJudge:', isMultiJudge);
	logger.debug('[updateTrainingSettings] user:', user.id);

	// training_sessionsレコードが存在するか確認
	const { data: existingSession } = await supabase
		.from('training_sessions')
		.select('session_id')
		.eq('session_id', params.id)
		.maybeSingle();

	logger.debug('[updateTrainingSettings] 既存レコード:', existingSession);

	if (!existingSession) {
		// レコードが存在しない場合は新規作成
		logger.debug('[updateTrainingSettings] レコードが存在しないため新規作成します');
		const { data: insertResult, error: insertError } = await supabase
			.from('training_sessions')
			.insert({
				session_id: params.id,
				max_judges: 100,
				show_individual_scores: true,
				show_score_comparison: true,
				show_deviation_analysis: false,
				is_multi_judge: isMultiJudge
			})
			.select();

		logger.debug('[updateTrainingSettings] 作成結果:', { insertResult, insertError });

		if (insertError) {
			logger.error('[updateTrainingSettings] ❌ 作成失敗:', insertError);
			return fail(500, { trainingSettingsError: m.action_trainingSettingsCreateFailed() });
		}

		logger.debug('[updateTrainingSettings] ✅ 作成成功');
		return { trainingSettingsSuccess: m.action_trainingSettingsCreated() };
	}

	// レコードが存在する場合は更新
	const { data: updateResult, error: updateError } = await supabase
		.from('training_sessions')
		.update({
			is_multi_judge: isMultiJudge
		})
		.eq('session_id', params.id)
		.select();

	logger.debug('[updateTrainingSettings] 更新結果:', { updateResult, updateError });

	if (updateError) {
		logger.error('[updateTrainingSettings] ❌ 更新失敗:', updateError);
		return fail(500, { trainingSettingsError: m.action_settingsUpdateFailed() });
	}

	logger.debug('[updateTrainingSettings] ✅ 更新成功');
	return { trainingSettingsSuccess: m.action_trainingSettingsUpdated() };
};

export const updateTournamentSettings = async ({
	request,
	params,
	locals: { supabase }
}: RequestEvent) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const formData = await request.formData();
	const scoringMethod = formData.get('scoringMethod') as string;
	const excludeExtremes = scoringMethod === '5judges';

	// 点差コントロールの設定を取得
	const enableScoreDiffControl = formData.get('enableScoreDiffControl') === 'on';
	const maxScoreDiffStr = formData.get('maxScoreDiff') as string;
	const maxScoreDiff =
		enableScoreDiffControl && maxScoreDiffStr ? parseInt(maxScoreDiffStr, 10) : null;

	// バリデーション
	if (enableScoreDiffControl && maxScoreDiff !== null) {
		if (isNaN(maxScoreDiff) || maxScoreDiff < 1 || maxScoreDiff > 10) {
			return fail(400, {
				tournamentSettingsError: m.action_scoreDiffRange()
			});
		}
	}

	const { error: updateError } = await supabase
		.from('sessions')
		.update({
			exclude_extremes: excludeExtremes,
			max_score_diff: maxScoreDiff
		})
		.eq('id', params.id);

	if (updateError) {
		return fail(500, { tournamentSettingsError: m.action_settingsUpdateFailed() });
	}

	return { tournamentSettingsSuccess: m.action_scoringMethodUpdated() };
};

export const updateSettings = async ({ request, params, locals: { supabase } }: RequestEvent) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const formData = await request.formData();
	const isMultiJudge = formData.get('isMultiJudge') === 'true';
	const requiredJudges = Number(formData.get('requiredJudges'));

	// Validate requiredJudges
	if (isMultiJudge && (!requiredJudges || requiredJudges < 1)) {
		return fail(400, { settingsError: m.action_requiredJudgesInvalid() });
	}

	// Check participant count if multi-judge mode is enabled
	if (isMultiJudge) {
		const { count, error: countError } = await supabase
			.from('session_participants')
			.select('*', { count: 'exact', head: true })
			.eq('session_id', params.id);

		if (countError) {
			return fail(500, { settingsError: m.action_participantCountFailed() });
		}

		if (requiredJudges > (count || 0)) {
			return fail(400, {
				settingsError: m.action_requiredJudgesExceed({ count: String(count) })
			});
		}
	}

	const { error: updateError } = await supabase
		.from('sessions')
		.update({
			is_multi_judge: isMultiJudge,
			required_judges: isMultiJudge ? requiredJudges : null
		})
		.eq('id', params.id);

	if (updateError) {
		return fail(500, { settingsError: m.action_settingsUpdateFailed() });
	}

	return { settingsSuccess: m.action_settingsUpdated() };
};
