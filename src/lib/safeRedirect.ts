/**
 * 認証フローの ?next= パラメータをサニタイズしてオープンリダイレクトを防ぐ。
 * auth/callback と login の両方で同じ判定を行うために共有する。
 */

const ALLOWED_PATHS = [
	'/dashboard',
	'/onboarding/create-organization',
	'/account',
	'/reset-password/confirm'
] as const;

// /organization/[uuid v4]
const ORGANIZATION_PATH_PATTERN =
	/^\/organization\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// /invite/[token]/complete  (token は英数字とハイフンのみ、最大64文字)
const INVITE_COMPLETE_PATTERN = /^\/invite\/[a-zA-Z0-9-]{1,64}\/complete$/;

/**
 * `next` 候補がアプリ内の許可された遷移先かを判定する。
 * 外部URL・プロトコル相対URL・想定外のパスはすべて false を返す。
 */
export function isSafeRedirectPath(next: string | null | undefined): next is string {
	if (!next) return false;
	if (!next.startsWith('/')) return false;
	// `//example.com` のようなプロトコル相対URLを弾く
	if (next.startsWith('//') || next.startsWith('/\\')) return false;

	if ((ALLOWED_PATHS as readonly string[]).includes(next)) return true;
	if (ORGANIZATION_PATH_PATTERN.test(next)) return true;
	if (INVITE_COMPLETE_PATTERN.test(next)) return true;

	return false;
}

/**
 * `next` を検証して、安全な遷移先かフォールバックを返す。
 */
export function getSafeRedirectPath(
	next: string | null | undefined,
	fallback: string
): string {
	return isSafeRedirectPath(next) ? next : fallback;
}
