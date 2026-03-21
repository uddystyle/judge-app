import type { SupabaseClient } from '@supabase/supabase-js';

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
		.delete()
		.eq('event_id', params.eventId)
		.eq('athlete_id', params.athleteId);

	if (params.guestIdentifier) {
		// 1. ゲストユーザーの場合
		console.log('[deleteTrainingScore] Deleting guest score:', params.guestIdentifier);
		deleteQuery = deleteQuery.eq('guest_identifier', params.guestIdentifier);
	} else if (params.judgeId) {
		// 2. 認証ユーザーの場合（judgeIdがフォームから送信されている）
		console.log('[deleteTrainingScore] Deleting user score:', params.judgeId);
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

		console.log('[deleteTrainingScore] Deleting user score (fallback):', judgeProfile.id);
		deleteQuery = deleteQuery.eq('judge_id', judgeProfile.id);
	}

	const { error: deleteError } = await deleteQuery;

	if (deleteError) {
		console.error('[deleteTrainingScore] Error:', deleteError);
		return { success: false, error: `得点の削除に失敗しました。${deleteError.message || ''}` };
	}

	return { success: true };
}
