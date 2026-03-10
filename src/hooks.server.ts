import { env } from '$env/dynamic/public';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { Handle } from '@sveltejs/kit';
import { randomBytes } from 'crypto';

export const handle: Handle = async ({ event, resolve }) => {
	// リクエストIDを生成して追跡
	const requestId = randomBytes(16).toString('hex');
	event.locals.requestId = requestId;

	const supabaseUrl = env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;
	const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl || !supabaseAnonKey) {
		console.error('Missing Supabase environment variables:', {
			hasUrl: !!supabaseUrl,
			hasKey: !!supabaseAnonKey,
			envKeys: Object.keys(env),
			processEnvKeys: Object.keys(process.env).filter(k => k.includes('SUPABASE'))
		});
		throw new Error('Supabase environment variables are not configured. Please check your Vercel environment settings.');
	}

	event.locals.supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: options.path ?? '/' });
				});
			}
		}
	});

	// サービスロールクライアント（RLSをバイパス）を作成
	// 組織作成時の最初のメンバー追加など、特別な操作に使用
	if (supabaseServiceKey) {
		event.locals.supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
			auth: {
				autoRefreshToken: false,
				persistSession: false
			}
		});
	}

	event.locals.getSession = async () => {
		// Supabase公式推奨パターン: safeGetSession()と同じロジック
		// getUser()でSupabase Authサーバーに問い合わせてJWTを検証
		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();

		// エラーまたはユーザーが存在しない場合はnullを返す
		if (error || !user) {
			return null;
		}

		// ユーザーが検証された後、セッション情報を取得
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();

		if (!session) {
			return null;
		}

		// 検証済みのユーザーオブジェクトでsession.userを上書きして返す
		// これにより、session.userにアクセスしても警告が出なくなる
		return {
			...session,
			user
		};
	};

	const response = await resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'cache-control';
		}
	});

	// リクエストIDをレスポンスヘッダーに追加
	response.headers.set('X-Request-ID', requestId);

	// パフォーマンス向上のためのキャッシュヘッダー設定
	// 静的リソース（CSS、JS、フォント等）のキャッシュ
	if (event.url.pathname.startsWith('/_app/')) {
		response.headers.set('cache-control', 'public, max-age=31536000, immutable');
	}
	// 完全に静的なページのみキャッシュ（ログイン状態に依存しないページ）
	else if (
		event.url.pathname.startsWith('/pricing') ||
		event.url.pathname.startsWith('/faq') ||
		event.url.pathname.startsWith('/privacy') ||
		event.url.pathname.startsWith('/terms') ||
		event.url.pathname.startsWith('/legal') ||
		event.url.pathname.startsWith('/contact')
	) {
		response.headers.set('cache-control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
	}
	// 認証が関わるページは絶対にキャッシュしない
	else if (
		event.url.pathname === '/' ||
		event.url.pathname.startsWith('/dashboard') ||
		event.url.pathname.startsWith('/login') ||
		event.url.pathname.startsWith('/signup') ||
		event.url.pathname.startsWith('/session') ||
		event.url.pathname.startsWith('/account') ||
		event.url.pathname.startsWith('/organization') ||
		event.url.pathname.startsWith('/onboarding')
	) {
		response.headers.set('cache-control', 'private, no-cache, no-store, must-revalidate');
		response.headers.set('pragma', 'no-cache');
		response.headers.set('expires', '0');
	}

	// セキュリティヘッダーの設定
	// クリックジャッキング対策: iframe での埋め込みを禁止
	response.headers.set('X-Frame-Options', 'DENY');

	// MIME タイプスニッフィング対策
	response.headers.set('X-Content-Type-Options', 'nosniff');

	// XSS保護（レガシーブラウザ向け）
	response.headers.set('X-XSS-Protection', '1; mode=block');

	// リファラーポリシー: 同一オリジンのみリファラーを送信
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

	// HTTPSの強制（本番環境のみ）
	if (event.url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
	}

	// Content Security Policy (CSP)
	// Google Fonts、Supabase、Stripe を許可
	// 本番環境では厳格なCSP、開発環境ではHMR/Viteのために緩和
	const isDevelopment = process.env.NODE_ENV === 'development';

	// Nonce生成（本番環境用）
	const cspNonce = randomBytes(16).toString('base64');
	event.locals.cspNonce = cspNonce;

	const scriptSrc = isDevelopment
		? "'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com"  // 開発: HMR/Viteのため緩和
		: `'self' 'nonce-${cspNonce}' https://js.stripe.com`;  // 本番: Nonce-based（unsafe削除）

	const cspDirectives = [
		"default-src 'self'",
		`script-src ${scriptSrc}`,
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",  // TODO: Nonce対応
		"font-src 'self' https://fonts.gstatic.com",
		"img-src 'self' data: https: blob:",
		"connect-src 'self' https://*.supabase.co https://api.stripe.com wss://*.supabase.co",
		"frame-src https://js.stripe.com",
		"frame-ancestors 'none'", // すべてのフレーミングを防止
		"base-uri 'self'",
		"form-action 'self'",
		"upgrade-insecure-requests", // HTTPSを強制
		"block-all-mixed-content" // HTTPSページでHTTPリソースを禁止
	].join('; ');
	response.headers.set('Content-Security-Policy', cspDirectives);

	return response;
};
