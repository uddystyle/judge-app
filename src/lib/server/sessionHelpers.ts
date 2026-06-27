import { error } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * セッション情報を取得する
 *
 * @throws 404 error if session not found (when throwOnError is true, default)
 * @returns session details or null (when throwOnError is false)
 */
export async function fetchSessionDetails(
	supabase: SupabaseClient,
	sessionId: string,
	options?: { throwOnError?: boolean }
) {
	const { data: sessionDetails, error: sessionError } = await supabase
		.from('sessions')
		.select('*')
		.eq('id', sessionId)
		.single();

	if (sessionError) {
		if (options?.throwOnError === false) {
			return null;
		}
		throw error(404, '検定が見つかりません。');
	}

	return sessionDetails;
}

/**
 * ユーザーのプロフィールを取得する（認証ユーザーの場合のみ）
 *
 * @returns profile data or null
 */
export async function fetchUserProfile(supabase: SupabaseClient, user: User | null) {
	if (!user) return null;

	const { data: profileData } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', user.id)
		.single();

	return profileData;
}

/**
 * 複数検定員モードかどうかを判定する
 *
 * ロジック:
 * - 研修モード → training_sessions.is_multi_judge
 * - 大会モード → 常にtrue
 * - 検定モード → sessions.is_multi_judge
 */
export async function getMultiJudgeMode(
	supabase: SupabaseClient,
	sessionId: string,
	modeType: string,
	sessionDetails: { is_multi_judge?: boolean; mode?: string }
): Promise<boolean> {
	const isTrainingMode = modeType === 'training' || sessionDetails.mode === 'training';

	if (isTrainingMode) {
		const { data: trainingSession } = await supabase
			.from('training_sessions')
			.select('is_multi_judge')
			.eq('session_id', sessionId)
			.maybeSingle();
		return trainingSession?.is_multi_judge || false;
	}

	if (modeType === 'tournament') {
		return true;
	}

	return sessionDetails.is_multi_judge || false;
}

/**
 * モードに応じて種目情報を取得する
 *
 * @returns event info or null
 */
export async function fetchEventInfo(
	supabase: SupabaseClient,
	eventId: string,
	sessionId: string,
	isTrainingMode: boolean
) {
	if (isTrainingMode) {
		const { data: trainingEvent } = await supabase
			.from('training_events')
			.select('*')
			.eq('id', eventId)
			.eq('session_id', sessionId)
			.single();
		return trainingEvent;
	}

	const { data: customEvent } = await supabase
		.from('custom_events')
		.select('*')
		.eq('id', eventId)
		.eq('session_id', sessionId)
		.single();
	return customEvent;
}

/**
 * 主任検定員かどうかを判定する
 */
export function isChiefJudge(
	user: User | null,
	sessionDetails: { chief_judge_id?: string }
): boolean {
	return user ? user.id === sessionDetails.chief_judge_id : false;
}

/**
 * 研修モードかどうかを判定する
 */
export function isTrainingModeCheck(modeType: string, sessionDetails: { mode?: string }): boolean {
	return modeType === 'training' || sessionDetails.mode === 'training';
}

/**
 * 大会モードかどうかを判定する
 */
export function isTournamentModeCheck(
	modeType: string,
	sessionDetails: { is_tournament_mode?: boolean; mode?: string }
): boolean {
	return (
		modeType === 'tournament' ||
		sessionDetails.is_tournament_mode === true ||
		sessionDetails.mode === 'tournament'
	);
}

/**
 * 検定員名を取得する（通常ユーザーまたはゲストユーザー）
 *
 * @returns judge name string
 * @throws returns null if neither user nor guest
 */
export async function getJudgeName(
	supabase: SupabaseClient,
	user: User | null,
	guestParticipant: { guest_name: string } | null,
	options?: { addGuestSuffix?: boolean }
): Promise<string | null> {
	if (guestParticipant) {
		return options?.addGuestSuffix
			? `${guestParticipant.guest_name} (ゲスト)`
			: guestParticipant.guest_name;
	}

	if (user) {
		const { data: profile } = await supabase
			.from('profiles')
			.select('full_name')
			.eq('id', user.id)
			.single();
		return profile?.full_name || user.email || 'Unknown';
	}

	return null;
}

/**
 * セッションの現在アクティブな採点指示 (scoring_prompts) を取得する
 *
 * 主任検定員が submitBib で作成し sessions.active_prompt_id に設定したプロンプトを返す。
 * 複数審判モードで「主任が指定した bib のみ採点可」を強制する用途（input 認可）と、
 * finalizeScore の冪等クリア（compare-and-swap）に使う。
 *
 * @returns アクティブなプロンプト、または存在しなければ null
 */
export async function fetchActivePrompt(
	supabase: SupabaseClient,
	sessionId: string
): Promise<{
	id: number | string;
	bib_number: number;
	level: string | null;
	discipline: string | null;
} | null> {
	const { data: session } = await supabase
		.from('sessions')
		.select('active_prompt_id')
		.eq('id', sessionId)
		.maybeSingle();

	if (!session?.active_prompt_id) {
		return null;
	}

	const { data: prompt } = await supabase
		.from('scoring_prompts')
		.select('id, bib_number, level, discipline')
		.eq('id', session.active_prompt_id)
		.maybeSingle();

	return prompt ?? null;
}

/**
 * 検定員表示名の正規化（一意判定用）。
 * 前後空白除去・NFC 正規化・小文字化で、紛らわしい同名/なりすましをまとめて判定する。
 */
export function normalizeJudgeName(name: string | null | undefined): string {
	if (!name) return '';
	return name.trim().normalize('NFC').toLowerCase();
}

/**
 * 指定セッション内で、検定員の表示名（候補）が既に使われているかを判定する。
 *
 * results は judge_name だけで行を識別するため、同名の検定員2人が同じ bib/種目を採点すると
 * 後勝ちで上書きされる。これを防ぐため、名前を選べるゲスト join 時にこの関数で一意化する。
 * - (a) セッション内の既存ゲスト名（guest_name）
 * - (b) セッション内の認証メンバーの profiles.full_name（ゲストが既存メンバー名を騙るのも防ぐ）
 * を正規化一致で照合する。RLS をバイパスして確実に読むため service role クライアントを渡すこと。
 *
 * @returns 既に使われていれば true
 */
export async function isJudgeNameTakenInSession(
	supabaseAdmin: SupabaseClient,
	sessionId: number | string,
	candidateName: string
): Promise<boolean> {
	const target = normalizeJudgeName(candidateName);
	if (!target) return false;

	const { data: participants } = await supabaseAdmin
		.from('session_participants')
		.select('guest_name, user_id, is_guest')
		.eq('session_id', sessionId);

	const memberUserIds: string[] = [];
	for (const p of participants ?? []) {
		if (p.is_guest) {
			if (normalizeJudgeName(p.guest_name) === target) return true;
		} else if (p.user_id) {
			memberUserIds.push(p.user_id);
		}
	}

	if (memberUserIds.length > 0) {
		const { data: profiles } = await supabaseAdmin
			.from('profiles')
			.select('full_name')
			.in('id', memberUserIds);
		for (const pr of profiles ?? []) {
			if (normalizeJudgeName(pr.full_name) === target) return true;
		}
	}

	return false;
}
