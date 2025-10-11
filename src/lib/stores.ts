// src/lib/stores.ts
import { writable } from 'svelte/store';
import type { User } from '@supabase/supabase-js';

// ログイン中のユーザー情報を保持するストア
export const currentUser = writable<User | null>(null);

// 選択中のセッション情報を保持するストア
export const currentSession = writable<any | null>(null);

export const currentBib = writable<number | null>(null);
