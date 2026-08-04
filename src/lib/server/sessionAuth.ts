import { redirect } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { logger } from '$lib/server/logger';

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
 * @param clientSuppliedGuestIdentifier - 旧: URLパラメータ由来のゲスト識別子。
 *   **認可には使わない**（クライアントが自由に指定できる値なので、信頼すると
 *   他ゲストへのなりすましが成立する）。身元は auth.uid() 束縛のみで判定し、
 *   この値は「束縛結果と食い違ったら警告ログを出す」観測用途にだけ使う。
 * @returns 認証結果（user, guestParticipant, guestIdentifier）
 * @throws redirect - 認証失敗時に /login または /session/join にリダイレクト
 */
export async function authenticateSession(
	supabase: SupabaseClient,
	sessionId: string,
	clientSuppliedGuestIdentifier: string | null
): Promise<AuthResult> {
	// ユーザー認証を確認（例外をキャッチしてredirectに変換）
	let user: User | null = null;
	let userError: any = null;

	try {
		const result = await supabase.auth.getUser();
		user = result.data.user;
		userError = result.error;
	} catch (error) {
		// getUser() が throw した場合も認証エラーとして扱う
		logger.error('[authenticateSession] getUser() threw exception:', error);
		throw redirect(303, '/login');
	}

	let guestParticipant: GuestParticipant | null = null;

	// ✅ ゲストの身元は auth.uid() に束縛された session_participants 行で確定する。
	// JWT の user_metadata は本人が updateUser({data}) で書き換えられるため、
	// guest_identifier / is_guest を認可の入力に使ってはならない（なりすまし防止）。
	const isGuest = user?.is_anonymous === true;

	// ゲストユーザーの場合
	if (isGuest && user) {
		// ゲスト参加者情報を検証（uid 束縛のみを信頼する）
		const { data: guestData, error: guestError } = await supabase
			.from('session_participants')
			.select('*')
			.eq('session_id', sessionId)
			.eq('user_id', user.id)
			.eq('is_guest', true)
			.maybeSingle();

		if (guestError || !guestData) {
			logger.error('[authenticateSession] ゲスト認証失敗:', guestError);
			throw redirect(303, '/session/join');
		}

		guestParticipant = guestData as GuestParticipant;
		warnOnIdentifierMismatch(
			'authenticateSession',
			clientSuppliedGuestIdentifier,
			guestParticipant
		);
	} else if (userError || !user) {
		// 認証ユーザーでもゲストでもない場合
		logger.error('[authenticateSession] 認証失敗:', userError);
		throw redirect(303, '/login');
	}

	return {
		user,
		guestParticipant,
		guestIdentifier: guestParticipant?.guest_identifier ?? null
	};
}

/**
 * クライアント由来の guest_identifier が、uid 束縛で確定した本来の identity と
 * 食い違うときだけ警告する。認可には一切影響しない（観測のみ）。
 * 古い招待リンクの再訪でも出るが、なりすましの試行もここに現れる。
 */
function warnOnIdentifierMismatch(
	label: string,
	clientSupplied: string | null,
	guestParticipant: GuestParticipant
) {
	if (clientSupplied && clientSupplied !== guestParticipant.guest_identifier) {
		logger.warn(
			`[${label}] クライアント指定の guest_identifier が uid 束縛と不一致のため無視しました:`,
			{
				supplied: clientSupplied,
				resolved: guestParticipant.guest_identifier,
				session_id: guestParticipant.session_id
			}
		);
	}
}

/**
 * アクション認証を行う（form action用）
 *
 * 認証ユーザーまたはゲストユーザーを検証します。
 * どちらも存在しない場合はエラーオブジェクトを返します（throw しない）。
 *
 * @param supabase - Supabaseクライアント
 * @param sessionId - セッションID
 * @param clientSuppliedGuestIdentifier - 旧: URLパラメータ／クライアント送信のゲスト識別子。
 *   **認可には使わない**。身元は auth.uid() 束縛の session_participants 行のみで
 *   判定し、この値は食い違い検知の警告ログにだけ使う。
 * @returns 認証結果または null（認証失敗時）
 */
export async function authenticateAction(
	supabase: SupabaseClient,
	sessionId: string,
	clientSuppliedGuestIdentifier: string | null
): Promise<AuthResult | null> {
	// ユーザー認証を確認（例外をキャッチしてnullに変換）
	let user: User | null = null;
	let userError: any = null;

	try {
		const result = await supabase.auth.getUser();
		user = result.data.user;
		userError = result.error;
	} catch (error) {
		// getUser() が throw した場合も認証エラーとして扱う
		logger.error('[authenticateAction] getUser() threw exception:', error);
		return null;
	}

	let guestParticipant: GuestParticipant | null = null;

	// ✅ ゲストの身元は auth.uid() に束縛された session_participants 行で確定する。
	// JWT の user_metadata は本人が updateUser({data}) で書き換えられるため、
	// guest_identifier / is_guest を認可の入力に使ってはならない（なりすまし防止）。
	const isGuest = user?.is_anonymous === true;

	// ゲストユーザーの場合
	if (isGuest && user) {
		// ゲスト参加者情報を検証（uid 束縛のみを信頼する）
		const { data: guestData, error: guestError } = await supabase
			.from('session_participants')
			.select('*')
			.eq('session_id', sessionId)
			.eq('user_id', user.id)
			.eq('is_guest', true)
			.maybeSingle();

		if (guestError || !guestData) {
			logger.error('[authenticateAction] ゲスト認証失敗:', guestError);
			return null;
		}

		guestParticipant = guestData as GuestParticipant;
		warnOnIdentifierMismatch('authenticateAction', clientSuppliedGuestIdentifier, guestParticipant);
	} else if (userError || !user) {
		// 認証ユーザーでもゲストでもない場合
		logger.error('[authenticateAction] 認証失敗:', userError);
		return null;
	}

	return {
		user,
		guestParticipant,
		guestIdentifier: guestParticipant?.guest_identifier ?? null
	};
}
