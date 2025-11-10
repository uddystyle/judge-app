// テスト用のモックユーティリティ

import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabaseクライアントのモックを作成
 */
export function createMockSupabaseClient() {
	const mockSelect = vi.fn().mockReturnThis();
	const mockInsert = vi.fn().mockReturnThis();
	const mockUpdate = vi.fn().mockReturnThis();
	const mockDelete = vi.fn().mockReturnThis();
	const mockEq = vi.fn().mockReturnThis();
	const mockGte = vi.fn().mockReturnThis();
	const mockLte = vi.fn().mockReturnThis();
	const mockSingle = vi.fn();
	const mockMaybeSingle = vi.fn();

	// チェーン可能なクエリビルダーを作成
	const createQueryBuilder = () => ({
		select: mockSelect,
		insert: mockInsert,
		update: mockUpdate,
		delete: mockDelete,
		eq: mockEq,
		gte: mockGte,
		lte: mockLte,
		single: mockSingle,
		maybeSingle: mockMaybeSingle
	});

	// from()が呼ばれるたびに新しいクエリビルダーを返す
	const mockFrom = vi.fn(() => createQueryBuilder());

	const mockGetUser = vi.fn();
	const mockGetSession = vi.fn();

	const mockSupabase = {
		from: mockFrom,
		auth: {
			getUser: mockGetUser,
			getSession: mockGetSession
		}
	} as unknown as SupabaseClient;

	return {
		supabase: mockSupabase,
		mocks: {
			from: mockFrom,
			select: mockSelect,
			insert: mockInsert,
			update: mockUpdate,
			delete: mockDelete,
			eq: mockEq,
			gte: mockGte,
			lte: mockLte,
			single: mockSingle,
			maybeSingle: mockMaybeSingle,
			getUser: mockGetUser,
			getSession: mockGetSession
		}
	};
}

/**
 * テスト用のユーザーデータを生成
 */
export function createMockUser(overrides: any = {}) {
	return {
		id: 'user-123',
		email: 'test@example.com',
		...overrides
	};
}

/**
 * テスト用のセッションデータを生成
 */
export function createMockSession(overrides: any = {}) {
	return {
		id: 'session-123',
		name: 'テストセッション',
		created_by: 'user-123',
		join_code: 'ABC123',
		mode: 'exam',
		created_at: new Date().toISOString(),
		...overrides
	};
}

/**
 * テスト用の組織データを生成
 */
export function createMockOrganization(overrides: any = {}) {
	return {
		id: 'org-123',
		name: 'テスト組織',
		plan_type: 'basic',
		max_members: 10,
		stripe_customer_id: 'cus_123',
		stripe_subscription_id: 'sub_123',
		created_at: new Date().toISOString(),
		...overrides
	};
}

/**
 * テスト用のサブスクリプションデータを生成
 */
export function createMockSubscription(overrides: any = {}) {
	return {
		id: 'sub-123',
		user_id: 'user-123',
		plan_type: 'basic',
		status: 'active',
		stripe_customer_id: 'cus_123',
		stripe_subscription_id: 'sub_123',
		organization_id: null,
		...overrides
	};
}

/**
 * テスト用の招待データを生成
 */
export function createMockInvitation(overrides: any = {}) {
	const expiresAt = new Date();
	expiresAt.setHours(expiresAt.getHours() + 48);

	return {
		id: 'invite-123',
		token: 'abc123def456',
		organization_id: 'org-123',
		created_by: 'user-123',
		role: 'member',
		expires_at: expiresAt.toISOString(),
		max_uses: null,
		used_count: 0,
		...overrides
	};
}

/**
 * Requestオブジェクトのモックを作成
 */
export function createMockRequest(body: any = {}, headers: any = {}) {
	return {
		json: async () => body,
		headers: new Headers(headers)
	} as Request;
}

/**
 * localsオブジェクトのモックを作成
 */
export function createMockLocals(supabase: SupabaseClient) {
	return {
		supabase
	};
}
