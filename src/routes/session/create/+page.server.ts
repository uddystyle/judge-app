import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkCanCreateSession, checkCanUseTrainingMode } from '$lib/server/organizationLimits';
import {
	countAvailableTickets,
	TOURNAMENT_CONTACT_URL,
	TOURNAMENT_TICKET_REQUIRED_MESSAGE
} from '$lib/server/tournamentTickets';
import { validateSessionName, validateUUID } from '$lib/server/validation';
import { randomBytes } from 'crypto';
import { rateLimiters, checkRateLimit } from '$lib/server/rateLimit';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals }) => {
	const {
		data: { user },
		error: userError
	} = await locals.supabase.auth.getUser();

	// 未ログインの場合はログインページへリダイレクト
	if (userError || !user) {
		throw redirect(303, '/login');
	}

	// ユーザーが所属するすべての組織を取得（複数組織対応）
	const { data: memberships } = await locals.supabase
		.from('organization_members')
		.select(
			`
			role,
			organizations (
				id,
				name,
				plan_type
			)
		`
		)
		.eq('user_id', user.id)
		.is('removed_at', null);

	// 組織に1つも所属していない場合は組織作成画面へリダイレクト
	if (!memberships || memberships.length === 0) {
		throw redirect(303, '/onboarding/create-organization');
	}

	// 組織配列を作成
	const organizations = memberships.map((m: any) => ({
		...m.organizations,
		userRole: m.role
	}));

	// 各組織の大会チケット残数（未使用）を取得
	// RLS により自組織分のみ読める。テーブル未作成等のエラー時は 0 扱い（表示用）。
	const { data: tickets } = await locals.supabase
		.from('tournament_tickets')
		.select('organization_id')
		.is('used_at', null);

	const ticketCounts: Record<string, number> = {};
	(tickets || []).forEach((t: { organization_id: string }) => {
		ticketCounts[t.organization_id] = (ticketCounts[t.organization_id] || 0) + 1;
	});

	return {
		user,
		organizations,
		ticketCounts
	};
};

// Helper function to generate a unique 8-character join code
// 紛らわしい文字を除外: 0,O,1,I
const generateUniqueJoinCode = async (supabase: SupabaseClient): Promise<string> => {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	const maxAttempts = 10;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const bytes = randomBytes(8);
		let code = '';

		for (let i = 0; i < 8; i++) {
			code += chars[bytes[i] % chars.length];
		}

		// 既存の参加コードと重複していないかチェック
		const { data, error } = await supabase
			.from('sessions')
			.select('id')
			.eq('join_code', code)
			.maybeSingle();

		if (error) {
			logger.error('Error checking join code:', error);
			continue;
		}

		if (!data) {
			// 重複なし - このコードを使用
			return code;
		}

		// 重複あり - 再試行
		logger.debug(`Join code collision detected: ${code}, retrying...`);
	}

	throw new Error('ユニークな参加コードの生成に失敗しました。');
};

export const actions: Actions = {
	// This `create` function will be called when the form is submitted
	create: async ({ request, locals: { supabase } }) => {
		// レート制限チェックを最初に実行
		const rateLimitResult = await checkRateLimit(request, rateLimiters?.api);
		if (!rateLimitResult.success) {
			return rateLimitResult.response;
		}

		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const sessionNameRaw = formData.get('sessionName') as string;
		const mode = formData.get('mode') as string;
		const maxJudgesStr = formData.get('maxJudges') as string;
		const isMultiJudgeStr = formData.get('isMultiJudge') as string;
		const organizationIdRaw = formData.get('organizationId') as string;

		// 組織IDのバリデーション（SQLインジェクション対策）
		const orgIdValidation = validateUUID(organizationIdRaw);
		if (!orgIdValidation.valid) {
			return fail(400, {
				sessionName: sessionNameRaw,
				error: orgIdValidation.error || '組織を選択してください。'
			});
		}
		const organizationId = organizationIdRaw;

		// ユーザーがその組織に所属しているか確認
		const { data: membership } = await supabase
			.from('organization_members')
			.select('organization_id')
			.eq('user_id', user.id)
			.eq('organization_id', organizationId)
			.is('removed_at', null)
			.maybeSingle();

		if (!membership) {
			return fail(403, { error: '選択した組織に所属していません。' });
		}

		// セッション名のバリデーション（XSS対策を含む）
		const nameValidation = validateSessionName(sessionNameRaw);
		if (!nameValidation.valid) {
			return fail(400, {
				sessionName: sessionNameRaw || '',
				error: nameValidation.error || 'セッション名が無効です。'
			});
		}
		const sessionName = nameValidation.sanitized!;

		// モードのバリデーション（SQLインジェクション対策）
		const validModes = ['kentei', 'tournament', 'training'];
		if (mode && !validModes.includes(mode)) {
			return fail(400, {
				sessionName,
				error: '無効なモードが選択されました。'
			});
		}

		// ============================================================
		// 組織ベースのプラン制限チェック
		// ============================================================

		// 1. セッション作成可否をチェック（組織ベース）
		// 大会セッションはチケット制（スポット販売）のため月間セッション数上限の対象外
		if (mode !== 'tournament') {
			const canCreateSession = await checkCanCreateSession(supabase, organizationId);
			if (!canCreateSession.allowed) {
				return fail(403, {
					sessionName,
					error: canCreateSession.reason || 'セッションを作成できません。',
					upgradeUrl: canCreateSession.upgradeUrl
				});
			}
		}

		// 2. 大会モードはチケット残数を事前チェック（案内用。最終判定と消費は
		//    DB トリガー（migration 1022）が insert 時に原子的に行う）
		if (mode === 'tournament') {
			const availableTickets = await countAvailableTickets(supabase, organizationId);
			if (availableTickets <= 0) {
				return fail(403, {
					sessionName,
					error: TOURNAMENT_TICKET_REQUIRED_MESSAGE,
					contactUrl: TOURNAMENT_CONTACT_URL
				});
			}
		}

		// 3. 研修モード利用可否をチェック（組織ベース）
		if (mode === 'training') {
			const canUseTraining = await checkCanUseTrainingMode(supabase, organizationId);
			if (!canUseTraining.allowed) {
				return fail(403, {
					sessionName,
					error: canUseTraining.reason || '研修モードを利用できません。',
					upgradeUrl: canUseTraining.upgradeUrl
				});
			}
		}

		// ユニークな参加コードを生成
		let joinCode: string;
		try {
			joinCode = await generateUniqueJoinCode(supabase);
		} catch (error) {
			logger.error('Failed to generate join code:', error);
			return fail(500, {
				sessionName,
				error: 'サーバーエラー: 参加コードの生成に失敗しました。もう一度お試しください。'
			});
		}

		const isTournamentMode = mode === 'tournament';
		const isTrainingMode = mode === 'training';

		// Determine session mode for database
		let sessionMode: 'certification' | 'tournament' | 'training';
		if (isTrainingMode) {
			sessionMode = 'training';
		} else if (isTournamentMode) {
			sessionMode = 'tournament';
		} else {
			sessionMode = 'certification';
		}

		// Insert the new session into the 'sessions' table
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.insert({
				name: sessionName,
				created_by: user.id,
				chief_judge_id: user.id, // 作成者を主任検定員に設定
				join_code: joinCode,
				is_active: true,
				is_accepting_participants: true, // 参加受付を開始
				status: 'active', // セッション状態を進行中に設定
				mode: sessionMode,
				is_tournament_mode: isTournamentMode, // 後方互換性のため保持
				score_calculation: isTournamentMode ? 'sum' : 'average',
				exclude_extremes: false,
				organization_id: organizationId // フォームで選択された組織ID
			})
			.select()
			.single();

		if (sessionError) {
			// DB トリガー（1022）によるチケット拒否（事前チェック後の同時消費レース等）
			if (sessionError.message?.includes('TOURNAMENT_TICKET_REQUIRED')) {
				return fail(403, {
					sessionName,
					error: TOURNAMENT_TICKET_REQUIRED_MESSAGE,
					contactUrl: TOURNAMENT_CONTACT_URL
				});
			}
			logger.error('Failed to create session:', sessionError);
			return fail(500, {
				sessionName,
				error: 'サーバーエラー: 検定の作成に失敗しました。'
			});
		}

		// Automatically add the creator as a participant
		const { error: participantError } = await supabase.from('session_participants').insert({
			session_id: sessionData.id,
			user_id: user.id
		});

		if (participantError) {
			logger.error('Failed to add participant:', participantError);
			// セッションは作成されたが参加者追加に失敗
			// RLSで自動的にアクセスできるはずだが、念のためエラーログを残す
			return fail(500, {
				sessionName,
				error: 'サーバーエラー: セッションへの参加に失敗しました。'
			});
		}

		// 研修モードの場合、training_sessions レコードを作成
		if (isTrainingMode) {
			const maxJudges = maxJudgesStr ? parseInt(maxJudgesStr, 10) : 100;
			const isMultiJudge = isMultiJudgeStr === 'true';

			// Validate maxJudges
			if (isNaN(maxJudges) || maxJudges < 1 || maxJudges > 100) {
				return fail(400, {
					sessionName,
					error: '最大検定員数は1〜100の範囲で指定してください。'
				});
			}

			const { error: trainingError } = await supabase.from('training_sessions').insert({
				session_id: sessionData.id,
				max_judges: maxJudges,
				show_individual_scores: true,
				show_score_comparison: true,
				show_deviation_analysis: false,
				is_multi_judge: isMultiJudge
			});

			if (trainingError) {
				logger.error('Failed to create training session:', trainingError);
				return fail(500, {
					sessionName,
					error: 'サーバーエラー: 研修モード設定の作成に失敗しました。'
				});
			}
		}

		// モードに応じてリダイレクト先を決定
		if (isTrainingMode) {
			// 研修モードは研修設定ページへ
			throw redirect(303, `/session/${sessionData.id}/training-setup`);
		} else if (isTournamentMode) {
			// 大会モードは大会設定ページへ
			throw redirect(303, `/session/${sessionData.id}/tournament-setup`);
		} else {
			// 検定モードはダッシュボードへ
			throw redirect(303, '/dashboard');
		}
	}
};
