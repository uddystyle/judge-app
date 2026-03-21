/**
 * TournamentSettings コンポーネントテスト
 *
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/svelte';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// $app/forms のモック
vi.mock('$app/forms', () => ({
	enhance: () => ({ destroy: () => {} })
}));

import TournamentSettings from './TournamentSettings.svelte';

describe('TournamentSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('主任検定員の場合', () => {
		it('3人の場合、3審3採が選択可能で5審3採が無効', () => {
			render(TournamentSettings, {
				props: {
					isChief: true,
					participantCount: 3,
					initialExcludeExtremes: false,
					initialMaxScoreDiff: null
				}
			});

			expect(screen.getByText('採点方法設定')).toBeInTheDocument();
			expect(screen.getByText('3審3採')).toBeInTheDocument();
			expect(screen.getByText('5審3採')).toBeInTheDocument();

			// 3審3採のラジオボタンが有効
			const radio3 = screen.getByDisplayValue('3judges') as HTMLInputElement;
			expect(radio3.disabled).toBe(false);

			// 5審3採のラジオボタンが無効
			const radio5 = screen.getByDisplayValue('5judges') as HTMLInputElement;
			expect(radio5.disabled).toBe(true);
		});

		it('5人の場合、5審3採が選択可能で3審3採が無効', () => {
			render(TournamentSettings, {
				props: {
					isChief: true,
					participantCount: 5,
					initialExcludeExtremes: true,
					initialMaxScoreDiff: null
				}
			});

			const radio3 = screen.getByDisplayValue('3judges') as HTMLInputElement;
			expect(radio3.disabled).toBe(true);

			const radio5 = screen.getByDisplayValue('5judges') as HTMLInputElement;
			expect(radio5.disabled).toBe(false);
		});

		it('3人でも5人でもない場合、エラーメッセージが表示される', () => {
			render(TournamentSettings, {
				props: {
					isChief: true,
					participantCount: 4,
					initialExcludeExtremes: false,
					initialMaxScoreDiff: null
				}
			});

			expect(screen.getByText(/3人または5人の検定員が必要です/)).toBeInTheDocument();
		});

		it('点差コントロールが初期状態で有効の場合、入力欄が表示される', () => {
			render(TournamentSettings, {
				props: {
					isChief: true,
					participantCount: 3,
					initialExcludeExtremes: false,
					initialMaxScoreDiff: 3
				}
			});

			// チェックボックスが有効
			const checkbox = screen.getByLabelText('点差制限を有効にする') as HTMLInputElement;
			expect(checkbox.checked).toBe(true);

			// 点差入力欄が表示される
			expect(screen.getByLabelText('最大許容点差')).toBeInTheDocument();
		});

		it('点差コントロールが無効の場合、入力欄が非表示', () => {
			render(TournamentSettings, {
				props: {
					isChief: true,
					participantCount: 3,
					initialExcludeExtremes: false,
					initialMaxScoreDiff: null
				}
			});

			const checkbox = screen.getByLabelText('点差制限を有効にする') as HTMLInputElement;
			expect(checkbox.checked).toBe(false);

			// 点差入力欄が非表示
			expect(screen.queryByLabelText('最大許容点差')).not.toBeInTheDocument();
		});

		it('成功メッセージが表示される', () => {
			render(TournamentSettings, {
				props: {
					isChief: true,
					participantCount: 3,
					initialExcludeExtremes: false,
					initialMaxScoreDiff: null,
					tournamentSettingsSuccess: '採点方法を更新しました。'
				}
			});

			expect(screen.getByText('採点方法を更新しました。')).toBeInTheDocument();
		});
	});

	describe('一般検定員の場合', () => {
		it('3審3採が読み取り専用で表示される', () => {
			render(TournamentSettings, {
				props: {
					isChief: false,
					participantCount: 3,
					initialExcludeExtremes: false,
					initialMaxScoreDiff: null
				}
			});

			expect(screen.getByText('3審3採')).toBeInTheDocument();
			expect(screen.getByText('3人の検定員の点数の合計')).toBeInTheDocument();
			expect(screen.getByText(/主任検定員のみ可能です/)).toBeInTheDocument();

			// ラジオボタンや保存ボタンが表示されない
			expect(screen.queryByDisplayValue('3judges')).not.toBeInTheDocument();
			expect(screen.queryByText('設定を保存')).not.toBeInTheDocument();
		});

		it('5審3採が読み取り専用で表示される', () => {
			render(TournamentSettings, {
				props: {
					isChief: false,
					participantCount: 5,
					initialExcludeExtremes: true,
					initialMaxScoreDiff: null
				}
			});

			expect(screen.getByText('5審3採')).toBeInTheDocument();
			expect(screen.getByText(/最大点数と最小点数を除く/)).toBeInTheDocument();
		});
	});
});
