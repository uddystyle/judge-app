/**
 * MultiJudgeSettings コンポーネントテスト
 *
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/svelte';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('$app/forms', () => ({
	enhance: () => ({ destroy: () => {} })
}));

import MultiJudgeSettings from './MultiJudgeSettings.svelte';

describe('MultiJudgeSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('研修モード（主任検定員）', () => {
		it('研修モード設定タイトルが表示される', () => {
			render(MultiJudgeSettings, {
				props: {
					isChief: true,
					mode: 'training',
					isMultiJudge: false
				}
			});

			expect(screen.getByText('研修モード設定')).toBeInTheDocument();
		});

		it('トグルスイッチと設定保存ボタンが表示される', () => {
			render(MultiJudgeSettings, {
				props: {
					isChief: true,
					mode: 'training',
					isMultiJudge: false
				}
			});

			expect(screen.getByText('複数検定員モード')).toBeInTheDocument();
			expect(screen.getByText('設定を保存')).toBeInTheDocument();
		});

		it('OFF状態で説明文が正しい', () => {
			render(MultiJudgeSettings, {
				props: {
					isChief: true,
					mode: 'training',
					isMultiJudge: false
				}
			});

			expect(screen.getByText(/各検定員が自由に選手・種目を選んで採点できます/)).toBeInTheDocument();
		});

		it('ON状態で説明文が正しい', () => {
			render(MultiJudgeSettings, {
				props: {
					isChief: true,
					mode: 'training',
					isMultiJudge: true
				}
			});

			expect(screen.getByText(/主任検定員が採点指示を出し/)).toBeInTheDocument();
		});

		it('成功メッセージが表示される', () => {
			render(MultiJudgeSettings, {
				props: {
					isChief: true,
					mode: 'training',
					isMultiJudge: false,
					settingsSuccess: '設定を更新しました。'
				}
			});

			expect(screen.getByText('設定を更新しました。')).toBeInTheDocument();
		});
	});

	describe('検定モード（主任検定員）', () => {
		it('採点ルール設定タイトルが表示される', () => {
			render(MultiJudgeSettings, {
				props: {
					isChief: true,
					mode: 'certification',
					isMultiJudge: false,
					participantCount: 3
				}
			});

			expect(screen.getByText('採点ルール設定')).toBeInTheDocument();
			expect(screen.getByText('複数審判モード')).toBeInTheDocument();
		});

		it('複数審判ON時に必須審判員数入力が表示される', () => {
			render(MultiJudgeSettings, {
				props: {
					isChief: true,
					mode: 'certification',
					isMultiJudge: true,
					requiredJudges: 3,
					participantCount: 5
				}
			});

			expect(screen.getByText('必須審判員数')).toBeInTheDocument();
			expect(screen.getByText(/現在: 5人/)).toBeInTheDocument();
		});

		it('複数審判OFF時に必須審判員数入力が非表示', () => {
			render(MultiJudgeSettings, {
				props: {
					isChief: true,
					mode: 'certification',
					isMultiJudge: false,
					participantCount: 3
				}
			});

			expect(screen.queryByText('必須審判員数')).not.toBeInTheDocument();
		});
	});

	describe('一般検定員（読み取り専用）', () => {
		it('研修モードで読み取り専用表示', () => {
			render(MultiJudgeSettings, {
				props: {
					isChief: false,
					mode: 'training',
					isMultiJudge: true
				}
			});

			expect(screen.getByText('ON')).toBeInTheDocument();
			expect(screen.getByText(/設定の変更は主任検定員のみ可能です/)).toBeInTheDocument();
			expect(screen.queryByText('設定を保存')).not.toBeInTheDocument();
		});

		it('検定モードで複数審判ON時に必須審判員数が読み取り専用表示', () => {
			render(MultiJudgeSettings, {
				props: {
					isChief: false,
					mode: 'certification',
					isMultiJudge: true,
					requiredJudges: 3,
					participantCount: 5
				}
			});

			expect(screen.getByText('ON')).toBeInTheDocument();
			expect(screen.getByText('3人')).toBeInTheDocument();
			expect(screen.getByText(/設定の変更は主任検定員のみ可能です/)).toBeInTheDocument();
		});
	});
});
