import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthResult } from '$lib/server/sessionAuth';
import { logger } from '$lib/server/logger';

/** 修正要求で「どの owner の採点行を消すか」 */
export interface CorrectionOwner {
	judgeId: string | null;
	guestIdentifier: string | null;
}

/**
 * 修正要求の削除対象 owner を決める。
 *
 * ⚠️ SECURITY: 以前はフォームの judgeId / guestIdentifier をそのまま削除条件にしていた。
 * 認可ゲートは「多審制なら主任のみ」だけだったため、**単独検定員モードでは任意の参加者が
 * 任意 owner の行を消そうとできた**（実際に消えるかは RLS 次第という状態）。
 *
 * ルール:
 * - 主任: フォームで指定された owner を対象にできる（他検定員の修正要求は主任の職務）
 * - それ以外: フォームの値は**一切信用せず**、自分の owner だけを対象にする
 */
export function resolveCorrectionOwner(
	authResult: AuthResult,
	isChief: boolean,
	requested: CorrectionOwner
): CorrectionOwner {
	if (isChief) {
		return {
			judgeId: requested.judgeId || null,
			guestIdentifier: requested.guestIdentifier || null
		};
	}

	if (authResult.guestParticipant) {
		return { judgeId: null, guestIdentifier: authResult.guestParticipant.guest_identifier };
	}

	return { judgeId: authResult.user?.id ?? null, guestIdentifier: null };
}

/**
 * 研修モードの得点を削除する（3段階の検定員ID解決付き）
 *
 * 検定員の特定方法（優先順位）:
 * 1. guestIdentifier が渡された場合 → guest_identifier で検索
 * 2. judgeId が渡された場合 → judge_id で検索
 * 3. どちらもない場合 → judgeName から profiles テーブルで検定員を逆引き
 *
 * @returns { success: true } | { success: false, error: string }
 */
export async function deleteTrainingScore(
	supabase: SupabaseClient,
	params: {
		eventId: string;
		athleteId: string;
		guestIdentifier?: string | null;
		judgeId?: string | null;
		judgeName: string;
	}
): Promise<{ success: true } | { success: false; error: string }> {
	let deleteQuery = supabase
		.from('training_scores')
		.delete({ count: 'exact' })
		.eq('event_id', params.eventId)
		.eq('athlete_id', params.athleteId);

	if (params.guestIdentifier) {
		// 1. ゲストユーザーの場合
		logger.debug('[deleteTrainingScore] Deleting guest score:', params.guestIdentifier);
		deleteQuery = deleteQuery.eq('guest_identifier', params.guestIdentifier);
	} else if (params.judgeId) {
		// 2. 認証ユーザーの場合（judgeIdがフォームから送信されている）
		logger.debug('[deleteTrainingScore] Deleting user score:', params.judgeId);
		deleteQuery = deleteQuery.eq('judge_id', params.judgeId);
	} else {
		// 3. フォールバック: judge_nameから検定員を特定
		const { data: judgeProfile } = await supabase
			.from('profiles')
			.select('id')
			.eq('full_name', params.judgeName)
			.maybeSingle();

		if (!judgeProfile) {
			return { success: false, error: '検定員が見つかりません。' };
		}

		logger.debug('[deleteTrainingScore] Deleting user score (fallback):', judgeProfile.id);
		deleteQuery = deleteQuery.eq('judge_id', judgeProfile.id);
	}

	const { error: deleteError, count } = await deleteQuery.select();

	if (deleteError) {
		logger.error('[deleteTrainingScore] Error:', deleteError);
		return { success: false, error: '得点の削除に失敗しました。時間をおいて再度お試しください。' };
	}

	// RLS で 0 行になっても success を返していたため、修正要求が黙って効かない状態だった。
	// 0 件は失敗として扱い、画面に出す。
	if (!count) {
		logger.error('[deleteTrainingScore] 削除された行が0件です（権限または対象なし）');
		return { success: false, error: '得点の削除に失敗しました（削除された行が0件）。' };
	}

	return { success: true };
}
