import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { appointChief, removeGuest, removeParticipant } from './actions/participants';
import {
	updateTrainingSettings,
	updateTournamentSettings,
	updateSettings
} from './actions/settings';
import { addEvent, updateEvent, deleteEvent } from './actions/events';
import {
	updateName,
	deleteSession,
	deleteTrainingData,
	deleteCertificationData,
	deleteTournamentData
} from './actions/dangerZone';
import * as m from '$lib/paraglide/messages.js';

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
		.select(
			'id, name, join_code, invite_token, created_by, chief_judge_id, is_multi_judge, required_judges, is_tournament_mode, mode, exclude_extremes, max_score_diff, organization_id'
		)
		.eq('id', sessionId)
		.single();

	// データベースからの取得に失敗した場合のデバッグログを追加
	if (sessionError) {
		// RLSが原因でデータが見つからない場合、Supabaseは404エラーではなく、エラーオブジェクトを返すため、ここで404を投げる
		throw error(404, {
			message: m.action_sessionNotFoundLoad()
		});
	}

	// --- 参加者の一覧をプロフィール情報と共に取得 ---
	// 通常ユーザーとゲストユーザーを両方取得
	const { data: participantData, error: participantsError } = await supabase
		.from('session_participants')
		.select('user_id, is_guest, guest_name, guest_identifier')
		.eq('session_id', sessionId);

	if (participantsError) {
		throw error(500, m.action_participantsFetchFailed());
	}

	// 各参加者のプロフィール情報を一括取得（N+1問題を解決）
	const userIds = (participantData || [])
		.filter((p) => !p.is_guest && p.user_id)
		.map((p) => p.user_id);

	// 全ユーザーのプロフィールを一度に取得
	const { data: profiles } =
		userIds.length > 0
			? await supabase.from('profiles').select('id, full_name').in('id', userIds)
			: { data: [] };

	// 全ユーザーの organization_members 情報を一度に取得（removed_at を含む）
	const { data: orgMembers } =
		userIds.length > 0 && sessionDetails.organization_id
			? await supabase
					.from('organization_members')
					.select('user_id, removed_at')
					.eq('organization_id', sessionDetails.organization_id)
					.in('user_id', userIds)
			: { data: [] };

	// プロフィールをマップ化
	const profileMap = new Map();
	(profiles || []).forEach((profile) => {
		profileMap.set(profile.id, profile);
	});

	// organization_members をマップ化
	const orgMemberMap = new Map();
	(orgMembers || []).forEach((member) => {
		orgMemberMap.set(member.user_id, member);
	});

	// 参加者データにプロフィールとメンバー情報をマージ
	const participants = (participantData || []).map((p) => {
		// ゲストユーザーの場合
		if (p.is_guest) {
			return {
				user_id: null,
				is_guest: true,
				guest_name: p.guest_name,
				guest_identifier: p.guest_identifier,
				profiles: null,
				removed_at: null
			};
		}

		// 通常ユーザーの場合
		const orgMember = orgMemberMap.get(p.user_id);
		return {
			user_id: p.user_id,
			is_guest: false,
			guest_name: null,
			profiles: profileMap.get(p.user_id) || null,
			removed_at: orgMember?.removed_at || null
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
			.select('id, event_name')
			.eq('session_id', sessionId)
			.order('display_order', { ascending: true });

		if (!eventsError) {
			events = customEvents || [];
		}
	} else if (sessionDetails.mode === 'training') {
		// 研修モード: training_events
		const { data: trainingEvents, error: eventsError } = await supabase
			.from('training_events')
			.select('id, name')
			.eq('session_id', sessionId)
			.order('order_index', { ascending: true });

		if (!eventsError) {
			events = trainingEvents || [];
		}

		// 研修セッション情報を取得
		const { data: trainingSessionData } = await supabase
			.from('training_sessions')
			.select('session_id, is_multi_judge')
			.eq('session_id', sessionId)
			.maybeSingle();

		trainingSession = trainingSessionData;

		// 研修モードの採点結果を取得（最新1000件に制限）
		const { data: scores } = await supabase
			.from('training_scores')
			.select(
				`
				score, judge_id, athlete_id,
				training_events!inner(session_id, name),
				athlete:athlete_id(bib_number, user_id, profiles:user_id(full_name))
			`
			)
			.eq('training_events.session_id', sessionId)
			.order('created_at', { ascending: false })
			.limit(1000);

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
					full_name: judgeProfileMap.get(score.judge_id)?.full_name || '-'
				}
			}));
		} else {
			trainingScores = [];
		}
	}

	// ユーザーのプロフィール情報と組織所属チェック
	const [profileResult, userOrgMembersResult] = await Promise.all([
		supabase.from('profiles').select('full_name').eq('id', user.id).single(),
		supabase
			.from('organization_members')
			.select('organization_id')
			.eq('user_id', user.id)
			.is('removed_at', null)
	]);

	const profile = profileResult.data;
	const userOrgMembers = userOrgMembersResult.data || [];
	const hasOrganization = userOrgMembers.length > 0;

	return {
		user,
		profile,
		hasOrganization,
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

// --- フォームアクション ---
// 本体は ./actions/ に分割されている（participants / settings / events / dangerZone）。
// 挙動は page.server.actions.test.ts と page.server.deleteData.test.ts で固定。
export const actions: Actions = {
	appointChief,
	removeGuest,
	removeParticipant,
	updateTrainingSettings,
	updateTournamentSettings,
	updateSettings,
	addEvent,
	updateEvent,
	deleteEvent,
	updateName,
	deleteSession,
	deleteTrainingData,
	deleteCertificationData,
	deleteTournamentData
};
