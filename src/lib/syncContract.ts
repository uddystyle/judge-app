/**
 * オフライン採点同期のクライアント/サーバー共有契約
 *
 * サーバー（$lib/server/scoreSync.ts）とクライアント（$lib/offline/scoreQueue.ts）の
 * 双方がこの定義を import する（二重定義によるドリフト防止）。
 */

/**
 * 一時的失敗（クライアントはキューに保持して再送してよい）の拒否理由。
 * サーバーはこれらを mutation log に記録しない。
 */
export const RETRYABLE_REASONS = ['auth_required', 'save_failed'] as const;

export type RetryableReason = (typeof RETRYABLE_REASONS)[number];

export function isRetryableReason(reason: string): boolean {
	return (RETRYABLE_REASONS as readonly string[]).includes(reason);
}

/**
 * 既存 action POST の fail(status) が「恒久的な検証拒否」かどうか。
 * 恒久的（true）なら端末キューから除去してよい。それ以外
 * （401 認証・408/429・5xx = サーバー側では auth_required / save_failed 相当）は
 * 一時的失敗なのでキューに保持し、自動同期の再送に委ねる。
 */
export function isPermanentActionFailureStatus(status: number): boolean {
	return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}
