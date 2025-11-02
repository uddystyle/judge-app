import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Helper function to generate a unique 6-digit join code
const generateUniqueJoinCode = async (supabase: SupabaseClient): Promise<string> => {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	const maxAttempts = 10;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		let code = '';
		for (let i = 0; i < 6; i++) {
			code += chars.charAt(Math.floor(Math.random() * chars.length));
		}

		// 既存の参加コードと重複していないかチェック
		const { data, error } = await supabase
			.from('sessions')
			.select('id')
			.eq('join_code', code)
			.maybeSingle();

		if (error) {
			console.error('Error checking join code:', error);
			continue;
		}

		if (!data) {
			// 重複なし - このコードを使用
			return code;
		}

		// 重複あり - 再試行
		console.log(`Join code collision detected: ${code}, retrying...`);
	}

	throw new Error('ユニークな参加コードの生成に失敗しました。');
};

export const actions: Actions = {
	// This `create` function will be called when the form is submitted
	create: async ({ request, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const sessionName = (formData.get('sessionName') as string)?.trim();
		const mode = formData.get('mode') as string;
		const maxJudgesStr = formData.get('maxJudges') as string;

		// Basic validation
		if (!sessionName) {
			return fail(400, { sessionName: '', error: 'セッション名を入力してください。' });
		}

		if (sessionName.length > 100) {
			return fail(400, {
				sessionName,
				error: 'セッション名は100文字以内にしてください。'
			});
		}

		// Validate mode
		if (mode && !['kentei', 'tournament', 'training'].includes(mode)) {
			return fail(400, {
				sessionName,
				error: '無効なモードが選択されました。'
			});
		}

		// ユニークな参加コードを生成
		let joinCode: string;
		try {
			joinCode = await generateUniqueJoinCode(supabase);
		} catch (error) {
			console.error('Failed to generate join code:', error);
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
				exclude_extremes: false
			})
			.select()
			.single();

		if (sessionError) {
			console.error('Failed to create session:', sessionError);
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
			console.error('Failed to add participant:', participantError);
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
				show_deviation_analysis: false
			});

			if (trainingError) {
				console.error('Failed to create training session:', trainingError);
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
