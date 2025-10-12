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
