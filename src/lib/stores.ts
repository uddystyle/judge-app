// src/lib/stores.ts
import { writable } from 'svelte/store';
import type { User } from '@supabase/supabase-js';

// ログイン中のユーザー情報を保持するストア
export const currentUser = writable<User | null>(null);

export const currentSession = writable<any | null>(null);
export const currentBib = writable<number | null>(null);
export const userProfile = writable<{ full_name: string } | null>(null);

// 現在選択中の種目情報を保持するストア
export const currentDiscipline = writable<string | null>(null);
export const currentLevel = writable<string | null>(null);
export const currentEvent = writable<string | null>(null);
