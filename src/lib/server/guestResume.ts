import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '$lib/server/logger';

/**
 * ゲスト identity の復帰トークン（migration 1026）
 *
 * ⚠️ なぜ guest_identifier と分けるのか:
 * `guest_identifier` は採点行の owner 列で、同一セッションの参加者全員に見える
 * （session_participants の SELECT、/api/score-status の応答、ScoresTable の hidden input）。
 * そのため「所持＝本人証明」のベアラ資格情報としては使えない。同席者が他検定員の
 * identity を乗っ取り、uid 束縛（1025）ごと奪って本人をロックアウトできてしまう。
 *
 * 本トークンは RLS 有効・ポリシー無しの `guest_resume_tokens` に置く（service role 専用）
 * ため、同席者は PostgREST から一切読めない。復帰リンクは `?resume=<token>` を使う。
 *
 * いずれの関数も supabaseAdmin（service role）を要求する。
 */

export interface ResumeParticipant {
	id: string;
	session_id: number | string;
	guest_identifier: string;
	guest_name: string;
	user_id: string | null;
}

/**
 * 参加者に復帰トークンを発行する（既に有れば作り直さず既存を返す）。
 *
 * 失敗しても null を返すだけで例外は投げない。呼び出し側（join / invite）は
 * トークンが無くても参加自体は成立させる（復帰できないだけで採点は可能）。
 */
export async function issueResumeToken(
	supabaseAdmin: SupabaseClient,
	participantId: string
): Promise<string | null> {
	const existing = await getResumeToken(supabaseAdmin, participantId);
	if (existing) return existing;

	const token = crypto.randomUUID();
	const { error } = await supabaseAdmin
		.from('guest_resume_tokens')
		.insert({ participant_id: participantId, token });

	if (error) {
		// 並行リクエストで先に作られていた場合は、それを読み直して返す
		const raced = await getResumeToken(supabaseAdmin, participantId);
		if (raced) return raced;

		logger.error('[GuestResume] 復帰トークンの発行エラー:', error);
		return null;
	}

	return token;
}

/** 参加者の復帰トークンを取得する（未発行なら null） */
export async function getResumeToken(
	supabaseAdmin: SupabaseClient,
	participantId: string
): Promise<string | null> {
	const { data, error } = await supabaseAdmin
		.from('guest_resume_tokens')
		.select('token')
		.eq('participant_id', participantId)
		.maybeSingle();

	if (error) {
		logger.error('[GuestResume] 復帰トークンの取得エラー:', error);
		return null;
	}

	return data?.token ?? null;
}

/**
 * 復帰トークンから参加者を引く。
 *
 * トークンは全体で一意だが、URL の sessionId と参加行の session_id が一致することも
 * 必ず確認する（他セッションのトークンで別セッションへ入れないようにする）。
 */
export async function findParticipantByResumeToken(
	supabaseAdmin: SupabaseClient,
	sessionId: string,
	token: string
): Promise<ResumeParticipant | null> {
	if (!token) return null;

	const { data, error } = await supabaseAdmin
		.from('guest_resume_tokens')
		.select(
			'participant_id, session_participants(id, session_id, guest_identifier, guest_name, user_id, is_guest)'
		)
		.eq('token', token)
		.maybeSingle();

	if (error) {
		logger.error('[GuestResume] 復帰トークンの照合エラー:', error);
		return null;
	}

	// supabase-js のリレーション展開は単一行でもオブジェクト/配列いずれもありうる
	const raw = (data as { session_participants?: unknown } | null)?.session_participants;
	const participant = (Array.isArray(raw) ? raw[0] : raw) as
		| (ResumeParticipant & { is_guest: boolean })
		| undefined;

	if (!participant || participant.is_guest !== true) return null;
	if (String(participant.session_id) !== String(sessionId)) {
		logger.warn('[GuestResume] トークンのセッションが URL と不一致:', {
			token_session_id: participant.session_id,
			url_session_id: sessionId
		});
		return null;
	}

	return {
		id: participant.id,
		session_id: participant.session_id,
		guest_identifier: participant.guest_identifier,
		guest_name: participant.guest_name,
		user_id: participant.user_id
	};
}
