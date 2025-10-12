import { env } from '$env/dynamic/public';
import { createServerClient } from '@supabase/ssr';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;

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

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range';
		}
	});
};
