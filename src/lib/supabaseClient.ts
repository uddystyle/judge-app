import { createBrowserClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';

// Get environment variables with fallback
const supabaseUrl = env.PUBLIC_SUPABASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
	console.error('Missing Supabase environment variables in browser');
}

// ブラウザ専用のSupabaseクライアントを作成し、エクスポートする
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

// JWT リフレッシュ監視（ブラウザ環境のみ）
if (typeof window !== 'undefined') {
	supabase.auth.onAuthStateChange((event, session) => {
		console.log('[supabaseClient] Auth state changed:', event);

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
					console.log('[supabaseClient] Redirecting to rejoin session:', sessionId);
					window.location.href = `/session/${sessionId}?expired=true`;
				}
			}
		} else if (event === 'USER_UPDATED') {
			console.log('[supabaseClient] User metadata updated');
		}
	});
}
