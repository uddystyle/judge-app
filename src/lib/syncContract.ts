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
