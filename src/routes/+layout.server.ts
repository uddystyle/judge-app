import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { getSession } }) => {
	// hooks.server.tsで準備したgetSession関数を使い、セッション情報を取得
	const session = await getSession();

	// 取得したセッション情報と、
	// クライアント側でSupabaseを初期化するためのキーの両方を渡す
	return {
		session,
		supabaseUrl: PUBLIC_SUPABASE_URL,
		supabaseAnonKey: PUBLIC_SUPABASE_ANON_KEY
	};
};
