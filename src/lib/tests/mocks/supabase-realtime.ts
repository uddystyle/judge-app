/**
 * Supabase Realtimeのモック
 * ユニットテストで使用
 */

import { vi } from 'vitest';

export type RealtimeCallback = (payload: any) => void;
export type RealtimeSubscribeCallback = (status: string) => void;

export interface MockRealtimeChannel {
	channelName: string;
	callbacks: Map<string, RealtimeCallback[]>;
	subscribeCallbacks: RealtimeSubscribeCallback[];
	isSubscribed: boolean;
}

export class MockSupabaseRealtime {
	private channels: Map<string, MockRealtimeChannel> = new Map();

	/**
	 * チャンネルを作成
	 */
	channel(channelName: string) {
		if (!this.channels.has(channelName)) {
			this.channels.set(channelName, {
				channelName,
				callbacks: new Map(),
				subscribeCallbacks: [],
				isSubscribed: false
			});
		}

		const channel = this.channels.get(channelName)!;

		return {
			on: (
				event: string,
				filter: any,
				callback: RealtimeCallback
			) => {
				const key = `${event}_${filter.table}`;
				if (!channel.callbacks.has(key)) {
					channel.callbacks.set(key, []);
				}
				channel.callbacks.get(key)!.push(callback);
				return this.channel(channelName);
			},

			subscribe: (callback?: RealtimeSubscribeCallback) => {
				if (callback) {
					channel.subscribeCallbacks.push(callback);
				}
				channel.isSubscribed = true;

				// 非同期でSUBSCRIBED状態を通知
				setTimeout(() => {
					channel.subscribeCallbacks.forEach((cb) => cb('SUBSCRIBED'));
				}, 0);

				return channel;
			}
		};
	}

	/**
	 * チャンネルを削除
	 */
	removeChannel(channel: any) {
		if (channel.channelName) {
			this.channels.delete(channel.channelName);
		}
	}

	/**
	 * イベントをシミュレート（テスト用）
	 */
	simulateEvent(
		channelName: string,
		eventType: 'INSERT' | 'UPDATE' | 'DELETE',
		table: string,
		payload: { new?: any; old?: any }
	) {
		const channel = this.channels.get(channelName);
		if (!channel || !channel.isSubscribed) {
			throw new Error(`Channel ${channelName} is not subscribed`);
		}

		const key = `postgres_changes_${table}`;
		const callbacks = channel.callbacks.get(key);
		if (!callbacks) {
			throw new Error(`No callbacks registered for ${key}`);
		}

		callbacks.forEach((callback) => {
			callback({
				eventType,
				new: payload.new,
				old: payload.old,
				table,
				schema: 'public'
			});
		});
	}

	/**
	 * すべてのチャンネルをクリア（テスト後のクリーンアップ用）
	 */
	clearAllChannels() {
		this.channels.clear();
	}

	/**
	 * チャンネルが購読されているか確認
	 */
	isChannelSubscribed(channelName: string): boolean {
		const channel = this.channels.get(channelName);
		return channel?.isSubscribed ?? false;
	}

	/**
	 * チャンネルの数を取得
	 */
	getChannelCount(): number {
		return this.channels.size;
	}
}

/**
 * Supabaseクライアントのモック
 */
export function createMockSupabaseClient() {
	const mockRealtime = new MockSupabaseRealtime();

	return {
		from: vi.fn((table: string) => ({
			select: vi.fn().mockReturnThis(),
			insert: vi.fn().mockReturnThis(),
			update: vi.fn().mockReturnThis(),
			delete: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			in: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({ data: null, error: null }),
			maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
		})),
		channel: mockRealtime.channel.bind(mockRealtime),
		removeChannel: mockRealtime.removeChannel.bind(mockRealtime),
		_mockRealtime: mockRealtime // テスト用の内部アクセス
	};
}
