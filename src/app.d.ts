// src/app.d.ts
import type { SupabaseClient, Session } from '@supabase/supabase-js';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			supabase: SupabaseClient;
			supabaseAdmin?: SupabaseClient;
			getSession(): Promise<Session | null>;
			lang: 'ja' | 'en';
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
