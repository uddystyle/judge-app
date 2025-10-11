import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { createServerClient } from '@supabase/ssr';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: event.cookies
	});

	event.locals.getSession = async () => {
		// 1. まず、ブラウザのクッキーからセッション情報を読み取る
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();

		// 2. もしセッションが存在する場合、そのユーザーが本物かサーバーに問い合わせて検証する
		if (session) {
			const {
				data: { user }
			} = await event.locals.supabase.auth.getUser();
			// もし検証の結果ユーザーが存在しなければ、そのセッションは無効とみなす
			if (!user) {
				return null;
			}
		}

		// 検証済みのセッション、またはnullを返す
		return session;
	};

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range';
		}
	});
};
