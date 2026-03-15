/**
 * コンポーネントレベル Realtime テスト
 *
 * 目的: 実際の +page.svelte をマウントして Realtime 購読の配線を検証する
 *
 * @vitest-environment jsdom
 */

import { render } from '@testing-library/svelte';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// グローバルモック変数（vi.mock()より前に宣言）
const mockGoto = vi.fn();
const mockChannelFn = vi.fn();
const mockOnFn = vi.fn();
const mockSubscribeFn = vi.fn();
const mockUnsubscribeFn = vi.fn();

// コールバックをキャプチャする変数
let capturedStatusCallback: ((status: string) => void) | null = null;
let capturedPostgresCallback: ((payload: any) => void) | null = null;

// チェーン可能なモックチャンネル
const mockChannel = {
	on: mockOnFn,
	subscribe: mockSubscribeFn,
	unsubscribe: mockUnsubscribeFn
};

// モック実装を設定
mockOnFn.mockImplementation((event: string, filter: any, callback: any) => {
	if (event === 'postgres_changes' && typeof callback === 'function') {
		capturedPostgresCallback = callback;
	}
	return mockChannel;
});
mockSubscribeFn.mockImplementation((callback?: (status: string) => void) => {
	if (typeof callback === 'function') {
		capturedStatusCallback = callback;
	}
	return 'ok';
});
mockUnsubscribeFn.mockImplementation(async () => ({ status: 'ok', error: null }));

const mockSupabase = {
	channel: mockChannelFn,
	removeChannel: vi.fn(async () => ({ status: 'ok', error: null })),
	from: vi.fn(() => ({
		select: vi.fn(() => ({
			eq: vi.fn(() => ({
				eq: vi.fn(() => ({
					maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
					single: vi.fn(() => Promise.resolve({ data: null, error: null }))
				})),
				maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
				single: vi.fn(() => Promise.resolve({ data: null, error: null }))
			}))
		}))
	}))
};

mockChannelFn.mockImplementation(() => mockChannel);

// $app/navigation のモック
vi.mock('$app/navigation', () => ({
	goto: mockGoto
}));

// $app/stores のモック
vi.mock('$app/stores', () => ({
	page: {
		subscribe: (fn: any) => {
			fn({
				url: new URL('http://localhost:5173/session/123'),
				params: { id: '123' },
				data: {}
			});
			return () => {};
		}
	}
}));

// $lib/supabaseClient のモック
vi.mock('$lib/supabaseClient', () => ({
	get supabase() {
		return mockSupabase;
	}
}));

// テスト用のモックデータ
const createMockData = (overrides = {}) => ({
	session: {
		id: 123,
		title: 'テストセッション',
		status: 'active' as const,
		mode: 'tournament' as const,
		discipline: 'trampoline' as const
	},
	sessionDetails: {
		id: 123,
		title: 'テストセッション',
		status: 'active' as const,
		mode: 'tournament' as const,
		discipline: 'trampoline' as const,
		active_prompt_id: null,
		active_prompt_bib: null,
		active_prompt_event_id: null
	},
	participant: {
		id: 1,
		session_id: 123,
		user_id: 'user-123',
		is_chief: false,
		is_guest: false,
		guest_identifier: null
	},
	isChief: false,
	isGuest: false,
	guestIdentifier: null,
	user: {
		id: 'user-123',
		email: 'test@example.com'
	},
	profile: {
		full_name: 'テストユーザー'
	},
	activePromptData: null,
	...overrides
});

describe('待機画面 - 実コンポーネント Realtime テスト', () => {
	beforeEach(() => {
		// モックのクリア
		vi.clearAllMocks();

		// コールバックキャプチャ変数をクリア
		capturedStatusCallback = null;
		capturedPostgresCallback = null;

		// モックの再設定
		mockOnFn.mockImplementation((event: string, filter: any, callback: any) => {
			if (event === 'postgres_changes' && typeof callback === 'function') {
				capturedPostgresCallback = callback;
			}
			return mockChannel;
		});
		mockSubscribeFn.mockImplementation((callback?: (status: string) => void) => {
			if (typeof callback === 'function') {
				capturedStatusCallback = callback;
			}
			return 'ok';
		});
		mockUnsubscribeFn.mockImplementation(async () => ({ status: 'ok', error: null }));
		mockChannelFn.mockImplementation(() => mockChannel);
		mockSupabase.removeChannel = vi.fn(async () => ({ status: 'ok', error: null }));
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('✅ 実コンポーネントがマウントされ、Realtime購読が初期化される', async () => {
		const data = createMockData();

		// 動的インポートで実コンポーネントをロード
		const PageComponent = (await import('./+page.svelte')).default;

		// 実際にコンポーネントをレンダリング
		const { unmount } = render(PageComponent, { props: { data } });

		// コンポーネントが非同期処理を完了するまで少し待機
		await new Promise(resolve => setTimeout(resolve, 100));

		// 検証: supabase.channel() が呼ばれたか
		expect(mockChannelFn).toHaveBeenCalled();

		// 検証: channel.on('postgres_changes', ...) が呼ばれたか
		expect(mockOnFn).toHaveBeenCalledWith(
			'postgres_changes',
			expect.objectContaining({
				event: 'UPDATE',
				schema: 'public',
				table: 'sessions'
			}),
			expect.any(Function)
		);

		// 検証: channel.subscribe() が呼ばれたか
		expect(mockSubscribeFn).toHaveBeenCalled();
		expect(mockSubscribeFn).toHaveBeenCalledWith(expect.any(Function));

		// クリーンアップ
		unmount();

		// 検証: アンマウント時に removeChannel() が呼ばれたか
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(mockSupabase.removeChannel).toHaveBeenCalled();
	});

	it('✅ 主任検定員の場合は Realtime 購読が行われない', async () => {
		const data = createMockData({
			isChief: true, // 主任検定員
			participant: {
				id: 1,
				session_id: 123,
				user_id: 'user-123',
				is_chief: true,
				is_guest: false
			}
		});

		const PageComponent = (await import('./+page.svelte')).default;
		const { unmount } = render(PageComponent, { props: { data } });

		await new Promise(resolve => setTimeout(resolve, 100));

		// 主任検定員の場合は Realtime 購読されない
		expect(mockChannelFn).not.toHaveBeenCalled();
		expect(mockSubscribeFn).not.toHaveBeenCalled();

		unmount();
	});

	it('✅ 大会モードの場合、正しいチャンネル名が使用される', async () => {
		const data = createMockData({
			session: {
				id: 456,
				mode: 'tournament' as const
			},
			sessionDetails: {
				id: 456,
				mode: 'tournament' as const,
				status: 'active' as const
			}
		});

		const PageComponent = (await import('./+page.svelte')).default;
		const { unmount } = render(PageComponent, { props: { data } });

		await new Promise(resolve => setTimeout(resolve, 100));

		// チャンネル名は `session-status-${sessionId}` 形式
		expect(mockChannelFn).toHaveBeenCalledWith('session-status-456');

		unmount();
	});

	it('✅ sessions テーブルの UPDATE イベントを監視する', async () => {
		const data = createMockData();

		const PageComponent = (await import('./+page.svelte')).default;
		const { unmount } = render(PageComponent, { props: { data } });

		await new Promise(resolve => setTimeout(resolve, 100));

		// postgres_changes の設定を確認
		const onCalls = mockOnFn.mock.calls;
		const postgresChangesCall = onCalls.find(call => call[0] === 'postgres_changes');

		expect(postgresChangesCall).toBeDefined();
		expect(postgresChangesCall![1]).toEqual(
			expect.objectContaining({
				event: 'UPDATE',
				schema: 'public',
				table: 'sessions',
				filter: 'id=eq.123'
			})
		);

		unmount();
	});

	it('✅ コンポーネントアンマウント時にクリーンアップが実行される', async () => {
		const data = createMockData();

		const PageComponent = (await import('./+page.svelte')).default;
		const { unmount } = render(PageComponent, { props: { data } });

		await new Promise(resolve => setTimeout(resolve, 100));

		// マウント時の呼び出し回数を記録
		const subscribeCallCount = mockSubscribeFn.mock.calls.length;
		expect(subscribeCallCount).toBeGreaterThan(0);

		// アンマウント
		unmount();

		// クリーンアップの完了を待つ
		await new Promise(resolve => setTimeout(resolve, 100));

		// removeChannel が呼ばれたことを確認
		expect(mockSupabase.removeChannel).toHaveBeenCalled();
	});

	// ========================================
	// Realtime状態遷移テスト（実コンポーネント）
	// ========================================

	it('✅ SUBSCRIBED statusコールバックが正しく発火する（実コンポーネント）', async () => {
		const data = createMockData();

		const PageComponent = (await import('./+page.svelte')).default;
		const { unmount } = render(PageComponent, { props: { data } });

		await new Promise(resolve => setTimeout(resolve, 100));

		// statusコールバックがキャプチャされていることを確認
		expect(capturedStatusCallback).toBeDefined();

		// SUBSCRIBEDイベントを発火 - エラーが発生しないことを確認
		expect(() => {
			capturedStatusCallback!('SUBSCRIBED');
		}).not.toThrow();

		unmount();
	});

	it('✅ CHANNEL_ERROR statusコールバックが正しく発火する（実コンポーネント）', async () => {
		const data = createMockData();

		const PageComponent = (await import('./+page.svelte')).default;
		const { unmount } = render(PageComponent, { props: { data } });

		await new Promise(resolve => setTimeout(resolve, 100));

		expect(capturedStatusCallback).toBeDefined();

		// CHANNEL_ERRORイベントを発火 - エラーが発生しないことを確認
		expect(() => {
			capturedStatusCallback!('CHANNEL_ERROR');
		}).not.toThrow();

		unmount();
	});

	it('✅ TIMED_OUT statusコールバックが正しく発火する（実コンポーネント）', async () => {
		const data = createMockData();

		const PageComponent = (await import('./+page.svelte')).default;
		const { unmount } = render(PageComponent, { props: { data } });

		await new Promise(resolve => setTimeout(resolve, 100));

		expect(capturedStatusCallback).toBeDefined();

		// TIMED_OUTイベントを発火 - エラーが発生しないことを確認
		expect(() => {
			capturedStatusCallback!('TIMED_OUT');
		}).not.toThrow();

		unmount();
	});

	it('✅ CLOSED statusコールバックが正しく発火する（実コンポーネント）', async () => {
		const data = createMockData();

		const PageComponent = (await import('./+page.svelte')).default;
		const { unmount } = render(PageComponent, { props: { data } });

		await new Promise(resolve => setTimeout(resolve, 100));

		expect(capturedStatusCallback).toBeDefined();

		// CLOSEDイベントを発火 - エラーが発生しないことを確認
		expect(() => {
			capturedStatusCallback!('CLOSED');
		}).not.toThrow();

		unmount();
	});

	it('✅ postgres_changes コールバックが正しく発火する（実コンポーネント）', async () => {
		const data = createMockData({
			sessionDetails: {
				id: 123,
				status: 'active' as const,
				mode: 'tournament' as const,
				discipline: 'trampoline' as const,
				active_prompt_id: null,
				active_prompt_bib: null,
				active_prompt_event_id: null
			}
		});

		const PageComponent = (await import('./+page.svelte')).default;
		const { unmount } = render(PageComponent, { props: { data } });

		await new Promise(resolve => setTimeout(resolve, 100));

		// postgres_changes コールバックがキャプチャされていることを確認
		expect(capturedPostgresCallback).toBeDefined();

		// 新規promptをシミュレート - エラーが発生しないことを確認
		expect(() => {
			capturedPostgresCallback!({
				eventType: 'UPDATE',
				new: {
					id: 123,
					status: 'active',
					active_prompt_id: 'prompt-999',
					active_prompt_bib: 15,
					active_prompt_event_id: 'event-456'
				},
				old: {
					id: 123,
					status: 'active',
					active_prompt_id: null
				}
			});
		}).not.toThrow();

		unmount();
	});
});
