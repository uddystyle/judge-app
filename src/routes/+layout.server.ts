import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	// クライアント側でSupabaseを初期化するためのキーを渡す
	return {
		supabaseUrl: PUBLIC_SUPABASE_URL,
		supabaseAnonKey: PUBLIC_SUPABASE_ANON_KEY
	};
};
