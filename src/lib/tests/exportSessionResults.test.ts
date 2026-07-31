/**
 * exportSessionResults ユニットテスト
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportSessionResults } from '$lib/exportSessionResults';

const mockXlsx = {
	utils: {
		json_to_sheet: vi.fn<(rows: Record<string, unknown>[]) => object>(() => ({})),
		book_new: vi.fn(() => ({})),
		book_append_sheet: vi.fn()
	},
	write: vi.fn(() => new ArrayBuffer(8)),
	writeFile: vi.fn()
};

vi.mock('xlsx', () => mockXlsx);

function mockFetchResponse(body: unknown, ok = true) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok, json: async () => body }))
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

const row = {
	created_at: '2026-07-01T00:00:00Z',
	bib: 5,
	score: 80,
	discipline: '基礎',
	level: '1級',
	event_name: '大回り',
	judge_name: '検定 太郎'
};

describe('exportSessionResults', () => {
	it('結果が空なら no-data を返し xlsx を生成しない', async () => {
		mockFetchResponse({ results: [] });

		const result = await exportSessionResults(1, 'テスト検定');

		expect(result).toEqual({ ok: false, reason: 'no-data' });
		expect(mockXlsx.utils.json_to_sheet).not.toHaveBeenCalled();
	});

	it('API が非 2xx なら no-data を返す（現行挙動の維持）', async () => {
		mockFetchResponse({ error: 'サーバーエラー' }, false);

		const result = await exportSessionResults(1, 'テスト検定');

		expect(result).toEqual({ ok: false, reason: 'no-data' });
	});

	it('結果があれば整形して xlsx をダウンロードする（jsdom は非モバイル経路）', async () => {
		mockFetchResponse({ results: [row] });

		const result = await exportSessionResults(1, 'テスト検定');

		expect(result).toEqual({ ok: true });
		// 1行が7列（日時/ゼッケン/得点/種別/級/種目/検定員）に整形される
		const sheetRows = mockXlsx.utils.json_to_sheet.mock.calls[0]![0];
		expect(sheetRows).toHaveLength(1);
		expect(Object.values(sheetRows[0])).toContain(5);
		expect(Object.values(sheetRows[0])).toContain('検定 太郎');
		// ファイル名はセッション名から生成
		expect(mockXlsx.writeFile).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringMatching(/^テスト検定_.*\.xlsx$/)
		);
	});

	it('fetch が例外を投げたら error を返す', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);

		const result = await exportSessionResults(1, 'テスト検定');

		expect(result).toEqual({ ok: false, reason: 'error' });
	});
});
