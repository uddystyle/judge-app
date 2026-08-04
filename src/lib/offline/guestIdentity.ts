/**
 * ゲスト identity のローカル永続化（network-resilience-strategy.md P3: 再認証フロー）
 *
 * 目的: 認証セッション（クッキー）が失われても、端末に残る guest_identifier で
 * 同一 identity を再採用し、オフラインで保存した採点を正しい owner で同期できるようにする。
 *
 * 信頼モデル（1026 で変更）: 復帰の資格情報は `resume_token`（guest_resume_tokens）。
 * `guest_identifier` は採点行の owner 列として**同席者全員に見える**ため、
 * ベアラ資格情報には使えない（同席者による identity 乗っ取りが成立してしまう）。
 * 再採用時の検証はサーバー（/session/[id] load の ?resume= 経路）が service role 専用
 * テーブルとの照合で行うため、ここは「端末に自分の identity を控える」だけの役割に留める。
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
	/** 復帰用トークン（1026）。旧エントリには無いので任意。無い場合は自動復帰できない */
	resume_token?: string;
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
	guestName: string,
	resumeToken?: string | null
): void {
	if (typeof localStorage === 'undefined') return;
	try {
		// トークンが取れなかった時に、既に控えてある有効なトークンを消さないようにする
		const existing = getSavedGuestIdentity(sessionId);
		const token =
			resumeToken ??
			(existing?.guest_identifier === guestIdentifier ? existing?.resume_token : undefined);

		localStorage.setItem(
			storageKey(sessionId),
			JSON.stringify({
				session_id: Number(sessionId),
				guest_identifier: guestIdentifier,
				guest_name: guestName,
				...(token ? { resume_token: token } : {})
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
					guest_name: parsed.guest_name,
					...(typeof parsed.resume_token === 'string' ? { resume_token: parsed.resume_token } : {})
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
						guest_name: parsed.guest_name,
						...(typeof parsed.resume_token === 'string'
							? { resume_token: parsed.resume_token }
							: {})
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
