import { createBrowserClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';

// ブラウザ専用のSupabaseクライアントを作成し、エクスポートする
export const supabase = createBrowserClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY);
