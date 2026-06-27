/**
 * セッション所有権（主任検定員 / 作成者）の引き継ぎロジック
 *
 * アカウント削除時に sessions.chief_judge_id / created_by に削除済みユーザーの UUID が
 * ダングリングで残り、採点制御・検定員管理が不能になるのを防ぐための純ロジック。
 * I/O を持たないため単体テスト可能。delete-user エンドポイントから利用する。
 */

export interface SessionOwnershipRow {
	chief_judge_id?: string | null;
	created_by?: string | null;
}

/**
 * 削除されるユーザーが chief / creator のセッションについて、適用すべき更新内容を返す。
 *
 * - chief_judge_id: 置換者がいれば再任命、いなければ NULL にする。
 *   （chief_judge_id は nullable。NULL でも org メンバーが appointChief で後から再任命できる）
 * - created_by: 置換者がいる場合のみ再任命する。
 *   （NOT NULL の可能性があるため、置換者がいなければ変更しない＝単独放棄セッションは現状維持）
 *
 * @returns 適用すべきカラムのみを含むオブジェクト（変更不要なら空オブジェクト）
 */
export function computeOwnershipReassign(
	session: SessionOwnershipRow,
	departingUserId: string,
	replacementUserId: string | null
): { chief_judge_id?: string | null; created_by?: string } {
	const update: { chief_judge_id?: string | null; created_by?: string } = {};

	if (session.chief_judge_id === departingUserId) {
		update.chief_judge_id = replacementUserId ?? null;
	}

	if (session.created_by === departingUserId && replacementUserId) {
		update.created_by = replacementUserId;
	}

	return update;
}
