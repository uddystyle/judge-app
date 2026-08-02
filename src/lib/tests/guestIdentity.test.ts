/**
 * ゲスト identity ローカル永続化のユニットテスト
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	persistGuestIdentity,
	getSavedGuestIdentity,
	clearSavedGuestIdentity,
	listSavedGuestIdentities
} from '$lib/offline/guestIdentity';

beforeEach(() => {
	localStorage.clear();
});

describe('guestIdentity（P3: 端末への identity 永続化）', () => {
	it('保存→取得のラウンドトリップ', () => {
		persistGuestIdentity(42, 'G-uuid', '山田太郎');
		const got = getSavedGuestIdentity(42);
		expect(got).toEqual({ session_id: 42, guest_identifier: 'G-uuid', guest_name: '山田太郎' });
	});

	it('文字列 sessionId でも同じキーで取得できる', () => {
		persistGuestIdentity('7', 'g7', 'ゲスト7');
		expect(getSavedGuestIdentity(7)?.guest_identifier).toBe('g7');
		expect(getSavedGuestIdentity('7')?.guest_name).toBe('ゲスト7');
	});

	it('未保存セッションは null', () => {
		expect(getSavedGuestIdentity(999)).toBeNull();
	});

	it('clear で削除される', () => {
		persistGuestIdentity(1, 'g1', 'A');
		clearSavedGuestIdentity(1);
		expect(getSavedGuestIdentity(1)).toBeNull();
	});

	it('listSavedGuestIdentities は保存済み全件を返し、無関係な localStorage キーは無視する', () => {
		persistGuestIdentity(1, 'g1', 'A');
		persistGuestIdentity(2, 'g2', 'B');
		localStorage.setItem('unrelated-key', 'x');

		const all = listSavedGuestIdentities();
		expect(all).toHaveLength(2);
		expect(all.map((i) => i.session_id).sort()).toEqual([1, 2]);
	});

	it('壊れた保存値は null / スキップされる（throw しない）', () => {
		localStorage.setItem('tento-guest-5', '{ not json');
		expect(getSavedGuestIdentity(5)).toBeNull();

		localStorage.setItem('tento-guest-6', JSON.stringify({ foo: 'bar' })); // 必須欠落
		expect(getSavedGuestIdentity(6)).toBeNull();

		persistGuestIdentity(7, 'g7', 'C');
		// 壊れた 5,6 を混ぜても list は健全な 7 のみ返す
		expect(listSavedGuestIdentities().map((i) => i.session_id)).toEqual([7]);
	});
});
