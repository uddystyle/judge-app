import { createBrowserClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
import { getSavedGuestIdentity } from '$lib/offline/guestIdentity';

// Get environment variables with fallback
const supabaseUrl =
	env.PUBLIC_SUPABASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
	console.error('Missing Supabase environment variables in browser');
}

// ブラウザ専用のSupabaseクライアントを作成し、エクスポートする
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

// JWT リフレッシュ監視（ブラウザ環境のみ）
if (typeof window !== 'undefined') {
	// 直前に active だったゲストの guest_identifier を記憶しておく。SIGNED_OUT では
	// session が null になり「今失効したのが誰か」が分からないため、ここで捕捉する。
	let lastKnownGuestIdentifier: string | null = null;

	supabase.auth.onAuthStateChange((event, session) => {
		console.log('[supabaseClient] Auth state changed:', event);

		// 現在のセッションがゲストなら identity を控える（認証ユーザーなら null に戻す）
		const sessionGuestIdentifier =
			session?.user?.user_metadata?.is_guest === true &&
			typeof session.user.user_metadata.guest_identifier === 'string'
				? session.user.user_metadata.guest_identifier
				: null;
		if (session) {
			lastKnownGuestIdentifier = sessionGuestIdentifier;
		}

		if (event === 'TOKEN_REFRESHED') {
			console.log('[supabaseClient] ✅ JWT refreshed successfully');
		} else if (event === 'SIGNED_OUT') {
			console.warn('[supabaseClient] ⚠️ Session expired or signed out');

			// JWT 有効期限切れの可能性 - 現在のページがゲストセッションの場合のみ再認証を促す
			const currentPath = window.location.pathname;
			const isGuestSession = currentPath.includes('/session/');

			if (isGuestSession) {
				// ゲストセッションで期限切れの場合、再参加を促す
				const sessionIdMatch = currentPath.match(/\/session\/(\d+)/);
				if (sessionIdMatch) {
					const sessionId = sessionIdMatch[1];
					// P3: 端末保存済みの guest identity があり、かつ「今失効したのがその本人」の時だけ
					// ?guest= で自動再採用する。共有端末で別ゲストや認証ユーザーが、前の利用者の
					// 保存 identity に誤って降格・すり替わるのを防ぐ（別人の採点への誤帰属防止）。
					// 復帰は resume_token でのみ行う（guest_identifier は同席者に見えるため
					// ベアラ資格情報にできない。1026）。旧エントリでトークンが無い場合は再参加へ。
					const saved = getSavedGuestIdentity(sessionId);
					if (saved && saved.resume_token && saved.guest_identifier === lastKnownGuestIdentifier) {
						console.log('[supabaseClient] Auto-resuming guest identity for session:', sessionId);
						window.location.href = `/session/${sessionId}?resume=${encodeURIComponent(saved.resume_token)}`;
					} else {
						console.log('[supabaseClient] Redirecting to rejoin session:', sessionId);
						window.location.href = `/session/${sessionId}?expired=true`;
					}
				}
			}
			lastKnownGuestIdentifier = null;
		} else if (event === 'USER_UPDATED') {
			console.log('[supabaseClient] User metadata updated');
		}
	});
}
