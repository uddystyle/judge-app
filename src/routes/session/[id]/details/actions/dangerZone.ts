import { fail, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { validateSessionName } from '$lib/server/validation';
import * as m from '$lib/paraglide/messages.js';
import { logger } from '$lib/server/logger';

// 名前変更・削除系アクション（details ページ）。
// 挙動は page.server.actions.test.ts / page.server.deleteData.test.ts で固定。

// セッション名を更新
export const updateName = async ({ request, params, locals: { supabase } }: RequestEvent) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		return fail(401, { error: m.action_loginRequired() });
	}

	const sessionId = params.id;

	// セッションが存在し、作成者が現在のユーザーかチェック
	const { data: session, error: sessionError } = await supabase
		.from('sessions')
		.select('created_by')
		.eq('id', sessionId)
		.single();

	if (sessionError || !session) {
		return fail(404, { error: m.action_sessionNotFound() });
	}

	if (session.created_by !== user.id) {
		return fail(403, { error: m.action_noPermissionEditName() });
	}

	const formData = await request.formData();
	const nameRaw = formData.get('name') as string;

	// バリデーション
	const nameValidation = validateSessionName(nameRaw);
	if (!nameValidation.valid) {
		return fail(400, {
			error: nameValidation.error || m.action_sessionNameInvalid(),
			name: nameRaw
		});
	}

	const name = nameValidation.sanitized || '';

	// セッション名を更新
	const { error: updateError } = await supabase
		.from('sessions')
		.update({ name })
		.eq('id', sessionId);

	if (updateError) {
		logger.error('Session name update error:', updateError);
		return fail(500, {
			error: m.action_sessionNameUpdateFailed(),
			name: nameRaw
		});
	}

	return { success: true, message: m.action_sessionNameUpdated() };
};

export const deleteSession = async ({ params, locals: { supabase } }: RequestEvent) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const sessionId = params.id;

	// First, verify that the current user is the creator of the session
	const { data: sessionData } = await supabase
		.from('sessions')
		.select('created_by')
		.eq('id', sessionId)
		.single();

	if (sessionData?.created_by !== user.id) {
		return fail(403, { error: m.action_noPermissionDeleteSession() });
	}

	// Delete related data in the correct order to respect database constraints
	await supabase.from('results').delete().eq('session_id', sessionId);
	await supabase.from('session_participants').delete().eq('session_id', sessionId);
	await supabase.from('scoring_prompts').delete().eq('session_id', sessionId);

	// Finally, delete the session itself
	const { error: deleteError } = await supabase.from('sessions').delete().eq('id', sessionId);

	if (deleteError) {
		return fail(500, { error: m.action_sessionDeleteFailed() });
	}

	// If successful, redirect to the dashboard
	throw redirect(303, '/dashboard');
};

export const deleteTrainingData = async ({ params, locals: { supabase } }: RequestEvent) => {
	logger.debug('[deleteTrainingData] ========== 採点データ削除開始 ==========');
	logger.debug('[deleteTrainingData] sessionId:', params.id);

	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		logger.error('[deleteTrainingData] ユーザー認証エラー:', userError);
		throw redirect(303, '/login');
	}

	logger.debug('[deleteTrainingData] ユーザーID:', user.id);

	const sessionId = params.id;

	// セッション情報を取得して権限とモードを確認
	const { data: sessionData, error: sessionError } = await supabase
		.from('sessions')
		.select('created_by, mode')
		.eq('id', sessionId)
		.single();

	logger.debug('[deleteTrainingData] セッション情報:', { sessionData, sessionError });

	if (sessionError || !sessionData) {
		logger.error('[deleteTrainingData] セッション取得エラー:', sessionError);
		return fail(404, { error: m.action_sessionNotFound() });
	}

	// セッション作成者のみがデータを削除できる
	if (sessionData.created_by !== user.id) {
		logger.error('[deleteTrainingData] 権限エラー: 作成者ではない');
		return fail(403, { error: m.action_noPermissionDeleteData() });
	}

	// 研修モードのみデータ削除可能
	if (sessionData.mode !== 'training') {
		logger.error('[deleteTrainingData] モードエラー:', sessionData.mode);
		return fail(400, { error: m.action_trainingModeOnly() });
	}

	logger.debug('[deleteTrainingData] 権限チェック完了');

	// training_eventsを取得
	const { data: trainingEvents, error: eventsError } = await supabase
		.from('training_events')
		.select('id')
		.eq('session_id', sessionId);

	logger.debug('[deleteTrainingData] training_events取得:', {
		count: trainingEvents?.length || 0,
		eventIds: trainingEvents?.map((e) => e.id),
		error: eventsError
	});

	if (eventsError) {
		logger.error('[deleteTrainingData] training_events取得エラー:', eventsError);
		return fail(500, { error: m.action_eventFetchFailed() });
	}

	if (trainingEvents && trainingEvents.length > 0) {
		const eventIds = trainingEvents.map((e) => e.id);

		logger.debug('[deleteTrainingData] training_scores削除を実行...');

		// RLSをバイパスするためにService Roleクライアントを使用
		const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
			auth: {
				autoRefreshToken: false,
				persistSession: false
			}
		});

		logger.debug('[deleteTrainingData] Service Roleクライアントを作成しました');

		// training_scoresを削除
		const { error: deleteScoresError, count } = await supabaseAdmin
			.from('training_scores')
			.delete({ count: 'exact' })
			.in('event_id', eventIds);

		logger.debug('[deleteTrainingData] 削除結果:', { count, error: deleteScoresError });

		if (deleteScoresError) {
			logger.error('[deleteTrainingData] 採点データの削除エラー:', deleteScoresError);
			return fail(500, {
				error: m.action_scoreDeleteFailed({ detail: deleteScoresError.message || '' })
			});
		}

		logger.debug('[deleteTrainingData] ✅ 採点データを削除しました:', count, '件');
	} else {
		logger.debug('[deleteTrainingData] 削除対象の種目がありません');
	}

	// active_prompt_id をクリアして進行状態をリセット
	const { error: updateError } = await supabase
		.from('sessions')
		.update({ active_prompt_id: null })
		.eq('id', sessionId);

	if (updateError) {
		logger.error('[deleteTrainingData] active_prompt_idクリアエラー:', updateError);
	}

	logger.debug('[deleteTrainingData] ========== 採点データ削除完了 ==========');
	return { success: true, message: m.action_trainingDataDeleted() };
};

export const deleteCertificationData = async ({ params, locals: { supabase } }: RequestEvent) => {
	logger.debug('[deleteCertificationData] ========== 採点データ削除開始 ==========');
	logger.debug('[deleteCertificationData] sessionId:', params.id);

	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		logger.error('[deleteCertificationData] ユーザー認証エラー:', userError);
		throw redirect(303, '/login');
	}

	const sessionId = params.id;

	// セッション情報を取得して権限とモードを確認
	const { data: sessionData, error: sessionError } = await supabase
		.from('sessions')
		.select('created_by, mode')
		.eq('id', sessionId)
		.single();

	if (sessionError || !sessionData) {
		logger.error('[deleteCertificationData] セッション取得エラー:', sessionError);
		return fail(404, { error: m.action_sessionNotFound() });
	}

	// セッション作成者のみがデータを削除できる
	if (sessionData.created_by !== user.id) {
		logger.error('[deleteCertificationData] 権限エラー: 作成者ではない');
		return fail(403, { error: m.action_noPermissionDeleteData() });
	}

	// 検定モードのみデータ削除可能
	if (sessionData.mode !== 'certification') {
		logger.error('[deleteCertificationData] モードエラー:', sessionData.mode);
		return fail(400, { error: m.action_certModeOnly() });
	}

	// RLSをバイパスするためにService Roleクライアントを使用
	const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
		auth: {
			autoRefreshToken: false,
			persistSession: false
		}
	});

	// resultsテーブルから該当セッションのデータを削除
	const { error: deleteError, count } = await supabaseAdmin
		.from('results')
		.delete({ count: 'exact' })
		.eq('session_id', sessionId);

	logger.debug('[deleteCertificationData] 削除結果:', { count, error: deleteError });

	if (deleteError) {
		logger.error('[deleteCertificationData] 採点データの削除エラー:', deleteError);
		return fail(500, {
			error: m.action_scoreDeleteFailed({ detail: deleteError.message || '' })
		});
	}

	logger.debug('[deleteCertificationData] ✅ 採点データを削除しました:', count, '件');

	// active_prompt_id をクリアして進行状態をリセット
	const { error: updateError } = await supabase
		.from('sessions')
		.update({ active_prompt_id: null })
		.eq('id', sessionId);

	if (updateError) {
		logger.error('[deleteCertificationData] active_prompt_idクリアエラー:', updateError);
	}

	logger.debug('[deleteCertificationData] ========== 採点データ削除完了 ==========');
	return { success: true, message: m.action_certDataDeleted() };
};

export const deleteTournamentData = async ({ params, locals: { supabase } }: RequestEvent) => {
	logger.debug('[deleteTournamentData] ========== 採点データ削除開始 ==========');
	logger.debug('[deleteTournamentData] sessionId:', params.id);

	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		logger.error('[deleteTournamentData] ユーザー認証エラー:', userError);
		throw redirect(303, '/login');
	}

	const sessionId = params.id;

	// セッション情報を取得して権限とモードを確認
	const { data: sessionData, error: sessionError } = await supabase
		.from('sessions')
		.select('created_by, mode')
		.eq('id', sessionId)
		.single();

	if (sessionError || !sessionData) {
		logger.error('[deleteTournamentData] セッション取得エラー:', sessionError);
		return fail(404, { error: m.action_sessionNotFound() });
	}

	// セッション作成者のみがデータを削除できる
	if (sessionData.created_by !== user.id) {
		logger.error('[deleteTournamentData] 権限エラー: 作成者ではない');
		return fail(403, { error: m.action_noPermissionDeleteData() });
	}

	// 大会モードのみデータ削除可能
	if (sessionData.mode !== 'tournament') {
		logger.error('[deleteTournamentData] モードエラー:', sessionData.mode);
		return fail(400, { error: m.action_tournamentModeOnly() });
	}

	// RLSをバイパスするためにService Roleクライアントを使用
	const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
		auth: {
			autoRefreshToken: false,
			persistSession: false
		}
	});

	// resultsテーブルから該当セッションのデータを削除
	const { error: deleteError, count } = await supabaseAdmin
		.from('results')
		.delete({ count: 'exact' })
		.eq('session_id', sessionId);

	logger.debug('[deleteTournamentData] 削除結果:', { count, error: deleteError });

	if (deleteError) {
		logger.error('[deleteTournamentData] 採点データの削除エラー:', deleteError);
		return fail(500, {
			error: m.action_scoreDeleteFailed({ detail: deleteError.message || '' })
		});
	}

	logger.debug('[deleteTournamentData] ✅ 採点データを削除しました:', count, '件');

	// active_prompt_id をクリアして進行状態をリセット
	const { error: updateError } = await supabase
		.from('sessions')
		.update({ active_prompt_id: null })
		.eq('id', sessionId);

	if (updateError) {
		logger.error('[deleteTournamentData] active_prompt_idクリアエラー:', updateError);
	}

	logger.debug('[deleteTournamentData] ========== 採点データ削除完了 ==========');
	return { success: true, message: m.action_tournamentDataDeleted() };
};
