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
export async function fetchUserProfile(
	supabase: SupabaseClient,
	user: User | null
) {
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
export function isTrainingModeCheck(
	modeType: string,
	sessionDetails: { mode?: string }
): boolean {
	return modeType === 'training' || sessionDetails.mode === 'training';
}

/**
 * 大会モードかどうかを判定する
 */
export function isTournamentModeCheck(
	modeType: string,
	sessionDetails: { is_tournament_mode?: boolean; mode?: string }
): boolean {
	return modeType === 'tournament' || sessionDetails.is_tournament_mode === true || sessionDetails.mode === 'tournament';
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
