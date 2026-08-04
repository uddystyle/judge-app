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

	describe('resume_token（1026: 復帰の資格情報）', () => {
		it('resume_token を保存→取得できる', () => {
			persistGuestIdentity(42, 'G-uuid', '山田太郎', 'tok-abc');
			expect(getSavedGuestIdentity(42)).toEqual({
				session_id: 42,
				guest_identifier: 'G-uuid',
				guest_name: '山田太郎',
				resume_token: 'tok-abc'
			});
		});

		it('token 未指定で上書きしても、同一ゲストの既存 token は保持される', () => {
			persistGuestIdentity(42, 'G-uuid', '山田太郎', 'tok-abc');
			// 名前変更などで token 無しの再保存が起きても、復帰できなくならないこと
			persistGuestIdentity(42, 'G-uuid', '山田次郎');
			expect(getSavedGuestIdentity(42)?.resume_token).toBe('tok-abc');
			expect(getSavedGuestIdentity(42)?.guest_name).toBe('山田次郎');
		});

		it('別ゲストで上書きした場合は前の token を引き継がない', () => {
			persistGuestIdentity(42, 'G-uuid', '山田太郎', 'tok-abc');
			persistGuestIdentity(42, 'OTHER-uuid', '別人');
			expect(getSavedGuestIdentity(42)?.resume_token).toBeUndefined();
		});

		it('旧エントリ（token 無し）も後方互換で読める', () => {
			localStorage.setItem(
				'tento-guest-8',
				JSON.stringify({ session_id: 8, guest_identifier: 'g8', guest_name: '旧' })
			);
			const got = getSavedGuestIdentity(8);
			expect(got?.guest_identifier).toBe('g8');
			expect(got?.resume_token).toBeUndefined();
		});

		it('listSavedGuestIdentities も resume_token を含める', () => {
			persistGuestIdentity(1, 'g1', 'A', 'tok-1');
			persistGuestIdentity(2, 'g2', 'B');
			const all = listSavedGuestIdentities().sort((a, b) => a.session_id - b.session_id);
			expect(all[0].resume_token).toBe('tok-1');
			expect(all[1].resume_token).toBeUndefined();
		});
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
