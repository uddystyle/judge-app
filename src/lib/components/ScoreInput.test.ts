/**
 * ScoreInput コンポーネントテスト
 *
 * 主目的: 空入力のまま「確定」しても 0 点が記録されない（#4 幻の0点バグの回帰防止）。
 * 空入力は「入力を促すアラート」を出し、明示的な 0 は有効値として通る（両者を区別する）。
 *
 * Svelte 5 では component.$on が使えないため、submit の有無は
 * AlertDialog（role="alertdialog"、開いているときだけ描画）の有無で判定する。
 *
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import * as m from '$lib/paraglide/messages.js';
import ScoreInput from './ScoreInput.svelte';

describe('ScoreInput', () => {
	const confirmName = m.score_confirm();

	it('数字未入力で確定すると、submit されず入力を促すアラートを表示する (#4)', async () => {
		render(ScoreInput, { props: { minScore: 0, maxScore: 100, maxDigits: 3 } });

		await fireEvent.click(screen.getByRole('button', { name: confirmName }));

		// アラートが開く＝ submit されていない（同じ文言が常時表示の説明文にもあるため dialog 内に限定して確認）
		const dialog = screen.getByRole('alertdialog');
		expect(dialog).toBeInTheDocument();
		expect(within(dialog).getByText(m.score_enterScore())).toBeInTheDocument();
	});

	it('数字を入力して確定すると、エラーアラートを出さずに送信される', async () => {
		const { container } = render(ScoreInput, {
			props: { minScore: 0, maxScore: 100, maxDigits: 3 }
		});

		await fireEvent.click(screen.getByRole('button', { name: '5' }));
		// 入力が反映されている
		expect(container.querySelector('.numeric-display')?.textContent).toBe('5');

		await fireEvent.click(screen.getByRole('button', { name: confirmName }));
		// アラートは開かない＝バリデーションを通過して submit された
		expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
	});

	it('明示的に 0 を入力した場合は有効値として通る（空入力とは区別される）', async () => {
		render(ScoreInput, { props: { minScore: 0, maxScore: 100, maxDigits: 3 } });

		await fireEvent.click(screen.getByRole('button', { name: '0' }));
		await fireEvent.click(screen.getByRole('button', { name: confirmName }));

		// 空入力と違い、明示的な 0 はアラートを出さずに通る
		expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
	});

	it('範囲外の値は範囲エラーを表示して送信されない', async () => {
		render(ScoreInput, { props: { minScore: 0, maxScore: 10, maxDigits: 2 } });

		await fireEvent.click(screen.getByRole('button', { name: '9' }));
		await fireEvent.click(screen.getByRole('button', { name: '9' })); // 99 > 10
		await fireEvent.click(screen.getByRole('button', { name: confirmName }));

		expect(screen.getByText(m.score_rangeError({ min: '0', max: '10' }))).toBeInTheDocument();
		expect(screen.getByRole('alertdialog')).toBeInTheDocument();
	});
});
