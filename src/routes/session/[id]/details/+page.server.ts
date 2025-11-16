import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { validateSessionName } from '$lib/server/validation';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user) {
		throw redirect(303, '/login');
	}

	const sessionId = params.id;

	// --- セッションの詳細情報を取得 ---
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	// データベースからの取得に失敗した場合のデバッグログを追加
	if (sessionError) {
		// RLSが原因でデータが見つからない場合、Supabaseは404エラーではなく、エラーオブジェクトを返すため、ここで404を投げる
		throw error(404, {
			message: '検定が見つかりません。データベースのアクセス権限を確認してください。'
		});
	}

	// --- 参加者の一覧をプロフィール情報と共に取得 ---
	// 通常ユーザーとゲストユーザーを両方取得
	const { data: participantData, error: participantsError } = await supabase
		.from('session_participants')
		.select('user_id, is_guest, guest_name, guest_identifier')
		.eq('session_id', sessionId);

	if (participantsError) {
		throw error(500, '参加者情報の取得に失敗しました。');
	}

	// 各参加者のプロフィール情報を一括取得（N+1問題を解決）
	const userIds = (participantData || [])
		.filter((p) => !p.is_guest && p.user_id)
		.map((p) => p.user_id);

	// 全ユーザーのプロフィールを一度に取得
	const { data: profiles } = userIds.length > 0
		? await supabase.from('profiles').select('id, full_name').in('id', userIds)
		: { data: [] };

	// プロフィールをマップ化
	const profileMap = new Map();
	(profiles || []).forEach((profile) => {
		profileMap.set(profile.id, profile);
	});

	// 参加者データにプロフィールをマージ
	const participants = (participantData || []).map((p) => {
		// ゲストユーザーの場合
		if (p.is_guest) {
			return {
				user_id: null,
				is_guest: true,
				guest_name: p.guest_name,
				guest_identifier: p.guest_identifier,
				profiles: null
			};
		}

		// 通常ユーザーの場合
		return {
			user_id: p.user_id,
			is_guest: false,
			guest_name: null,
			profiles: profileMap.get(p.user_id) || null
		};
	});

	// --- モードに応じて種目を取得 ---
	let events: any[] = [];
	let trainingSession = null;
	let trainingScores: any[] = [];

	if (sessionDetails.is_tournament_mode || sessionDetails.mode === 'tournament') {
		// 大会モード: custom_events
		const { data: customEvents, error: eventsError } = await supabase
			.from('custom_events')
			.select('*')
			.eq('session_id', sessionId)
			.order('display_order', { ascending: true });

		if (!eventsError) {
			events = customEvents || [];
		}
	} else if (sessionDetails.mode === 'training') {
		// 研修モード: training_events
		const { data: trainingEvents, error: eventsError } = await supabase
			.from('training_events')
			.select('*')
			.eq('session_id', sessionId)
			.order('order_index', { ascending: true });

		if (!eventsError) {
			events = trainingEvents || [];
		}

		// 研修セッション情報を取得
		const { data: trainingSessionData } = await supabase
			.from('training_sessions')
			.select('*')
			.eq('session_id', sessionId)
			.maybeSingle();

		trainingSession = trainingSessionData;

		// 研修モードの採点結果を取得
		const { data: scores } = await supabase
			.from('training_scores')
			.select(
				`
				*,
				training_events!inner(session_id, name),
				athlete:athlete_id(bib_number, user_id, profiles:user_id(full_name))
			`
			)
			.eq('training_events.session_id', sessionId)
			.order('created_at', { ascending: false });

		// 検定員の情報を一括取得してマージ（N+1問題を解決）
		if (scores && scores.length > 0) {
			const judgeIds = [...new Set(scores.map((score) => score.judge_id))];

			// 全検定員のプロフィールを一度に取得
			const { data: judgeProfiles } = await supabase
				.from('profiles')
				.select('id, full_name')
				.in('id', judgeIds);

			// 検定員プロフィールをマップ化
			const judgeProfileMap = new Map();
			(judgeProfiles || []).forEach((profile) => {
				judgeProfileMap.set(profile.id, profile);
			});

			// スコアに検定員情報をマージ
			trainingScores = scores.map((score) => ({
				...score,
				judge: {
					full_name: judgeProfileMap.get(score.judge_id)?.full_name || '不明'
				}
			}));
		} else {
			trainingScores = [];
		}
	}

	// ユーザーのプロフィール情報を取得
	const { data: profile } = await supabase
		.from('profiles')
		.select('full_name')
		.eq('id', user.id)
		.single();

	// ユーザーの所属組織を取得
	const { data: membershipData } = await supabase
		.from('organization_members')
		.select('organization_id, role')
		.eq('user_id', user.id);

	let organizations: any[] = [];
	if (membershipData && membershipData.length > 0) {
		const orgIds = membershipData.map((m: any) => m.organization_id);
		const { data: orgsData } = await supabase
			.from('organizations')
			.select('id, name')
			.in('id', orgIds);
		organizations = orgsData || [];
	}

	return {
		user,
		profile,
		organizations,
		currentUserId: user.id,
		sessionDetails,
		participants,
		events,
		trainingSession,
		trainingScores,
		isTournamentMode: sessionDetails.is_tournament_mode || sessionDetails.mode === 'tournament',
		isTrainingMode: sessionDetails.mode === 'training'
	};
};

// --- フォームアクション（名前の更新など） ---
export const actions: Actions = {
	appointChief: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		// フォームから任命するユーザーのIDを取得
		const formData = await request.formData();
		const userIdToAppoint = formData.get('userId') as string;

		// 任命しようとしているユーザーがゲストでないか確認
		const { data: participantData } = await supabase
			.from('session_participants')
			.select('is_guest')
			.eq('session_id', params.id)
			.eq('user_id', userIdToAppoint)
			.single();

		if (participantData?.is_guest) {
			return fail(400, { error: 'ゲストユーザーは主任検定員に任命できません。' });
		}

		// データベースを更新
		const { data: currentSession, error: fetchError } = await supabase
			.from('sessions')
			.select('chief_judge_id')
			.eq('id', params.id)
			.single();

		if (fetchError) {
			return fail(500, { error: '現在のセッション情報の取得に失敗しました。' });
		}

		const newChiefId = currentSession?.chief_judge_id === userIdToAppoint ? null : userIdToAppoint;

		const { error: appointError } = await supabase
			.from('sessions')
			.update({ chief_judge_id: newChiefId })
			.eq('id', params.id);

		if (appointError) {
			return fail(500, { error: '主任の任命/解除に失敗しました。' });
		}

		return { success: true };
	},

	removeGuest: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const guestIdentifier = formData.get('guestIdentifier') as string;

		if (!guestIdentifier) {
			return fail(400, { error: 'ゲスト識別子が指定されていません。' });
		}

		// セッションの作成者であることを確認
		const { data: session, error: sessionError } = await supabase
			.from('sessions')
			.select('created_by')
			.eq('id', params.id)
			.single();

		if (sessionError || !session) {
			return fail(404, { error: 'セッションが見つかりません。' });
		}

		if (session.created_by !== user.id) {
			return fail(403, { error: 'ゲストユーザーを削除する権限がありません。' });
		}

		// ゲストユーザーをsession_participantsから削除
		const { error: deleteError } = await supabase
			.from('session_participants')
			.delete()
			.eq('session_id', params.id)
			.eq('guest_identifier', guestIdentifier)
			.eq('is_guest', true);

		if (deleteError) {
			return fail(500, { error: 'ゲストユーザーの削除に失敗しました。' });
		}

		return { success: true, message: 'ゲストユーザーを削除しました。' };
	},

	updateTrainingSettings: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const isMultiJudge = formData.get('isMultiJudge') === 'true';

		console.log('[updateTrainingSettings] ========== 研修設定更新 ==========');
		console.log('[updateTrainingSettings] sessionId:', params.id);
		console.log('[updateTrainingSettings] isMultiJudge:', isMultiJudge);
		console.log('[updateTrainingSettings] user:', user.id);

		// training_sessionsレコードが存在するか確認
		const { data: existingSession } = await supabase
			.from('training_sessions')
			.select('session_id')
			.eq('session_id', params.id)
			.maybeSingle();

		console.log('[updateTrainingSettings] 既存レコード:', existingSession);

		if (!existingSession) {
			// レコードが存在しない場合は新規作成
			console.log('[updateTrainingSettings] レコードが存在しないため新規作成します');
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

			console.log('[updateTrainingSettings] 作成結果:', { insertResult, insertError });

			if (insertError) {
				console.error('[updateTrainingSettings] ❌ 作成失敗:', insertError);
				return fail(500, { trainingSettingsError: '研修モード設定の作成に失敗しました。' });
			}

			console.log('[updateTrainingSettings] ✅ 作成成功');
			return { trainingSettingsSuccess: '研修設定を作成しました。' };
		}

		// レコードが存在する場合は更新
		const { data: updateResult, error: updateError } = await supabase
			.from('training_sessions')
			.update({
				is_multi_judge: isMultiJudge
			})
			.eq('session_id', params.id)
			.select();

		console.log('[updateTrainingSettings] 更新結果:', { updateResult, updateError });

		if (updateError) {
			console.error('[updateTrainingSettings] ❌ 更新失敗:', updateError);
			return fail(500, { trainingSettingsError: '設定の更新に失敗しました。' });
		}

		console.log('[updateTrainingSettings] ✅ 更新成功');
		return { trainingSettingsSuccess: '研修設定を更新しました。' };
	},

	updateTournamentSettings: async ({ request, params, locals: { supabase } }) => {
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

		const { error: updateError } = await supabase
			.from('sessions')
			.update({
				exclude_extremes: excludeExtremes
			})
			.eq('id', params.id);

		if (updateError) {
			return fail(500, { tournamentSettingsError: '設定の更新に失敗しました。' });
		}

		return { tournamentSettingsSuccess: '採点方法を更新しました。' };
	},

	updateSettings: async ({ request, params, locals: { supabase } }) => {
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
			return fail(400, { settingsError: '必須審判員数を正しく入力してください。' });
		}

		// Check participant count if multi-judge mode is enabled
		if (isMultiJudge) {
			const { count, error: countError } = await supabase
				.from('session_participants')
				.select('*', { count: 'exact', head: true })
				.eq('session_id', params.id);

			if (countError) {
				return fail(500, { settingsError: '参加者数の確認に失敗しました。' });
			}

			if (requiredJudges > (count || 0)) {
				return fail(400, {
					settingsError: `必須審判員数は参加者数（${count}人）以下にしてください。`
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
			return fail(500, { settingsError: '設定の更新に失敗しました。' });
		}

		return { settingsSuccess: '設定を更新しました。' };
	},

	// 種目を追加（大会・研修共通）
	addEvent: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { eventError: '認証が必要です。' });
		}

		const formData = await request.formData();
		const eventName = formData.get('eventName') as string;

		if (!eventName || !eventName.trim()) {
			return fail(400, { eventError: '種目名を入力してください。' });
		}

		// セッション情報を取得してモードを確認
		const { data: session } = await supabase
			.from('sessions')
			.select('mode, is_tournament_mode')
			.eq('id', params.id)
			.single();

		if (!session) {
			return fail(404, { eventError: 'セッションが見つかりません。' });
		}

		const isTournament = session.is_tournament_mode || session.mode === 'tournament';
		const isTraining = session.mode === 'training';

		if (isTournament) {
			// 大会モード: custom_events
			const { data: maxOrderData } = await supabase
				.from('custom_events')
				.select('display_order')
				.eq('session_id', params.id)
				.order('display_order', { ascending: false })
				.limit(1)
				.single();

			const nextOrder = (maxOrderData?.display_order || 0) + 1;

			const { error: insertError } = await supabase.from('custom_events').insert({
				session_id: params.id,
				discipline: '大会',
				level: '共通',
				event_name: eventName.trim(),
				display_order: nextOrder
			});

			if (insertError) {
				return fail(500, { eventError: '種目の追加に失敗しました。' });
			}
		} else if (isTraining) {
			// 研修モード: training_events
			const { data: maxOrderData } = await supabase
				.from('training_events')
				.select('order_index')
				.eq('session_id', params.id)
				.order('order_index', { ascending: false })
				.limit(1)
				.single();

			const nextOrder = (maxOrderData?.order_index || 0) + 1;

			const { error: insertError } = await supabase.from('training_events').insert({
				session_id: params.id,
				name: eventName.trim(),
				order_index: nextOrder,
				min_score: 0,
				max_score: 100,
				score_precision: 1,
				status: 'pending'
			});

			if (insertError) {
				return fail(500, { eventError: '種目の追加に失敗しました。' });
			}
		}

		return { eventSuccess: '種目を追加しました。' };
	},

	// 種目を更新（大会・研修共通）
	updateEvent: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { eventError: '認証が必要です。' });
		}

		const formData = await request.formData();
		const eventId = formData.get('eventId') as string;
		const eventName = formData.get('eventName') as string;
		const isTraining = formData.get('isTraining') === 'true';

		if (!eventName || !eventName.trim()) {
			return fail(400, { eventError: '種目名を入力してください。' });
		}

		if (isTraining) {
			// 研修モード: training_events
			const { error: updateError } = await supabase
				.from('training_events')
				.update({ name: eventName.trim() })
				.eq('id', eventId)
				.eq('session_id', params.id);

			if (updateError) {
				return fail(500, { eventError: '種目の更新に失敗しました。' });
			}
		} else {
			// 大会モード: custom_events
			const { error: updateError } = await supabase
				.from('custom_events')
				.update({ event_name: eventName.trim() })
				.eq('id', eventId)
				.eq('session_id', params.id);

			if (updateError) {
				return fail(500, { eventError: '種目の更新に失敗しました。' });
			}
		}

		return { eventSuccess: '種目を更新しました。' };
	},

	// 種目を削除（大会・研修共通）
	deleteEvent: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { eventError: '認証が必要です。' });
		}

		const formData = await request.formData();
		const eventId = formData.get('eventId') as string;
		const isTraining = formData.get('isTraining') === 'true';

		if (!eventId) {
			return fail(400, { eventError: '種目IDが指定されていません。' });
		}

		if (isTraining) {
			// 研修モード: training_events
			const { error: deleteError } = await supabase
				.from('training_events')
				.delete()
				.eq('id', eventId)
				.eq('session_id', params.id);

			if (deleteError) {
				return fail(500, { eventError: '種目の削除に失敗しました。' });
			}
		} else {
			// 大会モード: custom_events
			const { error: deleteError } = await supabase
				.from('custom_events')
				.delete()
				.eq('id', eventId)
				.eq('session_id', params.id);

			if (deleteError) {
				return fail(500, { eventError: '種目の削除に失敗しました。' });
			}
		}

		return { eventSuccess: '種目を削除しました。' };
	},

	// セッション名を更新
	updateName: async ({ request, params, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			return fail(401, { error: 'ログインが必要です。' });
		}

		const sessionId = params.id;

		// セッションが存在し、作成者が現在のユーザーかチェック
		const { data: session, error: sessionError } = await supabase
			.from('sessions')
			.select('created_by')
			.eq('id', sessionId)
			.single();

		if (sessionError || !session) {
			return fail(404, { error: 'セッションが見つかりません。' });
		}

		if (session.created_by !== user.id) {
			return fail(403, { error: 'セッション名を変更する権限がありません。' });
		}

		const formData = await request.formData();
		const nameRaw = formData.get('name') as string;

		// バリデーション
		const nameValidation = validateSessionName(nameRaw);
		if (!nameValidation.valid) {
			return fail(400, {
				error: nameValidation.error || 'セッション名が無効です。',
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
			console.error('Session name update error:', updateError);
			return fail(500, {
				error: 'セッション名の更新に失敗しました。しばらくしてから再度お試しください。',
				name: nameRaw
			});
		}

		return { success: true, message: 'セッション名を更新しました。' };
	},

	deleteSession: async ({ params, locals: { supabase } }) => {
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
			return fail(403, { error: '検定を削除する権限がありません。' });
		}

		// Delete related data in the correct order to respect database constraints
		await supabase.from('results').delete().eq('session_id', sessionId);
		await supabase.from('session_participants').delete().eq('session_id', sessionId);
		await supabase.from('scoring_prompts').delete().eq('session_id', sessionId);

		// Finally, delete the session itself
		const { error: deleteError } = await supabase.from('sessions').delete().eq('id', sessionId);

		if (deleteError) {
			return fail(500, { error: '検定の削除に失敗しました。' });
		}

		// If successful, redirect to the dashboard
		throw redirect(303, '/dashboard');
	}
};
