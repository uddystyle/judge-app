import { redirect } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * セッション参加者（ゲストユーザー）の型
 */
export interface GuestParticipant {
	id: string;
	session_id: string;
	guest_identifier: string;
	guest_name: string;
	is_guest: boolean;
	created_at: string;
}

/**
 * 認証結果の型
 */
export interface AuthResult {
	user: User | null;
	guestParticipant: GuestParticipant | null;
	guestIdentifier: string | null;
}

/**
 * セッション認証を行う（load関数用）
 *
 * 認証ユーザーまたはゲストユーザーを検証します。
 * どちらも存在しない場合は適切なページにリダイレクトします。
 *
 * @param supabase - Supabaseクライアント
 * @param sessionId - セッションID
 * @param guestIdentifier - ゲスト識別子（URLパラメータから）
 * @returns 認証結果（user, guestParticipant, guestIdentifier）
 * @throws redirect - 認証失敗時に /login または /session/join にリダイレクト
 */
export async function authenticateSession(
	supabase: SupabaseClient,
	sessionId: string,
	guestIdentifier: string | null
): Promise<AuthResult> {
	// ユーザー認証を確認
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	let guestParticipant: GuestParticipant | null = null;

	// ゲストユーザーの場合
	if (!user && guestIdentifier) {
		// ゲスト参加者情報を検証
		const { data: guestData, error: guestError } = await supabase
			.from('session_participants')
			.select('*')
			.eq('session_id', sessionId)
			.eq('guest_identifier', guestIdentifier)
			.eq('is_guest', true)
			.single();

		if (guestError || !guestData) {
			console.error('[authenticateSession] ゲスト認証失敗:', guestError);
			throw redirect(303, '/session/join');
		}

		guestParticipant = guestData as GuestParticipant;
	} else if (userError || !user) {
		// 認証ユーザーでもゲストでもない場合
		console.error('[authenticateSession] 認証失敗:', userError);
		throw redirect(303, '/login');
	}

	return {
		user,
		guestParticipant,
		guestIdentifier
	};
}

/**
 * アクション認証を行う（form action用）
 *
 * 認証ユーザーまたはゲストユーザーを検証します。
 * どちらも存在しない場合はエラーオブジェクトを返します（throw しない）。
 *
 * @param supabase - Supabaseクライアント
 * @param sessionId - セッションID
 * @param guestIdentifier - ゲスト識別子（URLパラメータから）
 * @returns 認証結果または null（認証失敗時）
 */
export async function authenticateAction(
	supabase: SupabaseClient,
	sessionId: string,
	guestIdentifier: string | null
): Promise<AuthResult | null> {
	// ユーザー認証を確認
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	let guestParticipant: GuestParticipant | null = null;

	// ゲストユーザーの場合
	if (!user && guestIdentifier) {
		// ゲスト参加者情報を検証
		const { data: guestData, error: guestError } = await supabase
			.from('session_participants')
			.select('*')
			.eq('session_id', sessionId)
			.eq('guest_identifier', guestIdentifier)
			.eq('is_guest', true)
			.single();

		if (guestError || !guestData) {
			console.error('[authenticateAction] ゲスト認証失敗:', guestError);
			return null;
		}

		guestParticipant = guestData as GuestParticipant;
	} else if (userError || !user) {
		// 認証ユーザーでもゲストでもない場合
		console.error('[authenticateAction] 認証失敗:', userError);
		return null;
	}

	return {
		user,
		guestParticipant,
		guestIdentifier
	};
}
