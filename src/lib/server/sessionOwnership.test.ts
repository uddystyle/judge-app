/**
 * computeOwnershipReassign テスト
 *
 * アカウント削除時のセッション所有権（chief_judge_id / created_by）引き継ぎロジック（#8）を検証する。
 */

import { describe, it, expect } from 'vitest';
import { computeOwnershipReassign } from './sessionOwnership';

const UID = 'departing-user-uuid';
const OTHER = 'replacement-user-uuid';

describe('computeOwnershipReassign', () => {
	it('置換者がいれば chief / creator の両方を再任命する', () => {
		const update = computeOwnershipReassign({ chief_judge_id: UID, created_by: UID }, UID, OTHER);
		expect(update).toEqual({ chief_judge_id: OTHER, created_by: OTHER });
	});

	it('置換者がいなければ chief は NULL・created_by は変更しない（NOT NULL 回避）', () => {
		const update = computeOwnershipReassign({ chief_judge_id: UID, created_by: UID }, UID, null);
		expect(update).toEqual({ chief_judge_id: null });
		expect('created_by' in update).toBe(false);
	});

	it('chief だけが対象なら chief のみ', () => {
		expect(
			computeOwnershipReassign({ chief_judge_id: UID, created_by: OTHER }, UID, OTHER)
		).toEqual({ chief_judge_id: OTHER });
	});

	it('creator だけが対象で置換者ありなら created_by のみ', () => {
		expect(
			computeOwnershipReassign({ chief_judge_id: OTHER, created_by: UID }, UID, OTHER)
		).toEqual({ created_by: OTHER });
	});

	it('どちらも対象でなければ空オブジェクト（更新なし）', () => {
		expect(
			computeOwnershipReassign({ chief_judge_id: OTHER, created_by: OTHER }, UID, OTHER)
		).toEqual({});
	});

	it('chief/creator が null のセッションは対象外', () => {
		expect(
			computeOwnershipReassign({ chief_judge_id: null, created_by: null }, UID, OTHER)
		).toEqual({});
	});
});
