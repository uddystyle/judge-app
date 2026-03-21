/**
 * EventManagement コンポーネントテスト
 *
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/svelte';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// $app/forms のモック（use:enhance で使用）
vi.mock('$app/forms', () => ({
	enhance: () => ({ destroy: () => {} })
}));

import EventManagement from './EventManagement.svelte';

describe('EventManagement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('主任検定員の場合', () => {
		it('種目一覧と追加フォームが表示される（大会モード）', () => {
			const events = [
				{ id: 1, event_name: '大回り' },
				{ id: 2, event_name: '小回り' }
			];

			render(EventManagement, {
				props: {
					events,
					isTrainingMode: false,
					isChief: true
				}
			});

			expect(screen.getByText('種目管理')).toBeInTheDocument();
			expect(screen.getByText('大回り')).toBeInTheDocument();
			expect(screen.getByText('小回り')).toBeInTheDocument();
			expect(screen.getByPlaceholderText('種目名 (例: 大回り)')).toBeInTheDocument();
			expect(screen.getByText('追加')).toBeInTheDocument();
			// 編集・削除ボタンがある
			expect(screen.getAllByText('編集')).toHaveLength(2);
			expect(screen.getAllByText('削除')).toHaveLength(2);
		});

		it('種目一覧と追加フォームが表示される（研修モード）', () => {
			const events = [
				{ id: 1, name: 'プルーク' },
				{ id: 2, name: 'シュテム' }
			];

			render(EventManagement, {
				props: {
					events,
					isTrainingMode: true,
					isChief: true
				}
			});

			expect(screen.getByText('プルーク')).toBeInTheDocument();
			expect(screen.getByText('シュテム')).toBeInTheDocument();
		});

		it('種目がない場合、空メッセージが表示される', () => {
			render(EventManagement, {
				props: {
					events: [],
					isTrainingMode: false,
					isChief: true
				}
			});

			expect(screen.getByText('種目が登録されていません')).toBeInTheDocument();
			// 追加フォームは表示される
			expect(screen.getByPlaceholderText('種目名 (例: 大回り)')).toBeInTheDocument();
		});

		it('成功メッセージが表示される', () => {
			render(EventManagement, {
				props: {
					events: [],
					isTrainingMode: false,
					isChief: true,
					eventSuccess: '種目を追加しました。'
				}
			});

			expect(screen.getByText('種目を追加しました。')).toBeInTheDocument();
		});

		it('エラーメッセージが表示される', () => {
			render(EventManagement, {
				props: {
					events: [],
					isTrainingMode: false,
					isChief: true,
					eventError: '種目の追加に失敗しました。'
				}
			});

			expect(screen.getByText('種目の追加に失敗しました。')).toBeInTheDocument();
		});
	});

	describe('一般検定員の場合', () => {
		it('種目は閲覧のみで編集・削除ボタンがない', () => {
			const events = [
				{ id: 1, event_name: '大回り' },
				{ id: 2, event_name: '小回り' }
			];

			render(EventManagement, {
				props: {
					events,
					isTrainingMode: false,
					isChief: false
				}
			});

			expect(screen.getByText('大回り')).toBeInTheDocument();
			expect(screen.getByText('小回り')).toBeInTheDocument();
			// 編集・削除ボタンがない
			expect(screen.queryByText('編集')).not.toBeInTheDocument();
			expect(screen.queryByText('削除')).not.toBeInTheDocument();
			// 追加フォームがない
			expect(screen.queryByPlaceholderText('種目名 (例: 大回り)')).not.toBeInTheDocument();
			// 権限メッセージが表示される
			expect(screen.getByText(/主任検定員のみ可能です/)).toBeInTheDocument();
		});

		it('種目がない場合、空メッセージが表示される', () => {
			render(EventManagement, {
				props: {
					events: [],
					isTrainingMode: false,
					isChief: false
				}
			});

			expect(screen.getByText('種目が登録されていません')).toBeInTheDocument();
		});
	});
});
