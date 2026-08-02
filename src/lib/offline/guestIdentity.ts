/**
 * ゲスト identity のローカル永続化（network-resilience-strategy.md P3: 再認証フロー）
 *
 * 目的: 認証セッション（クッキー）が失われても、端末に残る guest_identifier で
 * 同一 identity を再採用し、オフラインで保存した採点を正しい owner で同期できるようにする。
 *
 * 信頼モデル: guest_identifier はランダム UUID（推測不能）。所持＝本人証明という
 * ベアラモデルで、既存の `?guest=<guest_identifier>` 招待リンクと同一の信頼水準。
 * 再採用時の検証はサーバー（/session/[id] load の ?guest= 移行）が session_participants
 * 照合で行うため、ここは「端末に自分の identity を控える」だけの役割に留める。
 *
 * 注意: ITP 等でストレージが一括削除される環境（iOS 非インストール7日）では、
 * この localStorage も IndexedDB の採点キューも同時に消えるため復元対象が無い。
 * P3 が効くのは「クッキー失効・匿名ユーザー削除・セッション無効化」等で
 * 認証だけ失われ、端末ストレージは残るケース。
 */

const PREFIX = 'tento-guest-';
const storageKey = (sessionId: number | string) => `${PREFIX}${sessionId}`;

export interface SavedGuestIdentity {
	session_id: number;
	guest_identifier: string;
	guest_name: string;
}

function isValid(v: unknown): v is SavedGuestIdentity {
	return (
		typeof v === 'object' &&
		v !== null &&
		typeof (v as SavedGuestIdentity).guest_identifier === 'string' &&
		typeof (v as SavedGuestIdentity).guest_name === 'string' &&
		(v as SavedGuestIdentity).session_id != null
	);
}

/** 認証済みゲストの identity を端末に控える（session ページで JWT 検証済みの値から呼ぶ） */
export function persistGuestIdentity(
	sessionId: number | string,
	guestIdentifier: string,
	guestName: string
): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(
			storageKey(sessionId),
			JSON.stringify({
				session_id: Number(sessionId),
				guest_identifier: guestIdentifier,
				guest_name: guestName
			})
		);
	} catch {
		// プライベートブラウズ等で localStorage 不可でも致命ではない（次善: 再採用不可）
	}
}

/** 指定セッションの保存済みゲスト identity を取得（無ければ null） */
export function getSavedGuestIdentity(sessionId: number | string): SavedGuestIdentity | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(storageKey(sessionId));
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return isValid(parsed)
			? {
					session_id: Number(sessionId),
					guest_identifier: parsed.guest_identifier,
					guest_name: parsed.guest_name
				}
			: null;
	} catch {
		return null;
	}
}

/** 指定セッションの保存済みゲスト identity を削除（通常ユーザーとして参加した時など） */
export function clearSavedGuestIdentity(sessionId: number | string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(storageKey(sessionId));
	} catch {
		// no-op
	}
}

/** 端末に保存された全セッションのゲスト identity（join ページの「再開」候補表示用） */
export function listSavedGuestIdentities(): SavedGuestIdentity[] {
	if (typeof localStorage === 'undefined') return [];
	const out: SavedGuestIdentity[] = [];
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k || !k.startsWith(PREFIX)) continue;
			const raw = localStorage.getItem(k);
			if (!raw) continue;
			try {
				const parsed = JSON.parse(raw);
				if (isValid(parsed)) {
					out.push({
						session_id: Number(parsed.session_id),
						guest_identifier: parsed.guest_identifier,
						guest_name: parsed.guest_name
					});
				}
			} catch {
				// 壊れたエントリはスキップ
			}
		}
	} catch {
		// no-op
	}
	return out;
}
