/**
 * 検定(legacy) submitScore の active-prompt 認可ゲート（M3）の logic-mirror テスト。
 *
 * 実装（src/routes/session/[id]/[discipline]/[level]/[event]/score/+page.server.ts の submitScore）と
 * 同じ規則をミラーして回帰検知する:
 *   - 主任(chief) / ゲスト(guest) / 単独審判(is_multi_judge=false) はゲート対象外 → 常に採点可
 *   - 多審制かつ非主任かつ非ゲストの審判は、主任が指定した active prompt の
 *     (bib_number, discipline, level, event_name) に完全一致するときのみ採点可
 *   - active prompt 未設定 → 不可
 */

import { describe, it, expect } from 'vitest';

type Prompt = {
	bib_number: number;
	discipline: string | null;
	level: string | null;
	event_name: string | null;
} | null;

type Target = { bib: number; discipline: string; level: string; eventName: string };

function isScoreAllowed(args: {
	isMultiJudge: boolean;
	isChief: boolean;
	isGuest: boolean;
	activePrompt: Prompt;
	target: Target;
}): boolean {
	const { isMultiJudge, isChief, isGuest, activePrompt, target } = args;
	// ゲート対象外（主任・ゲスト・単独審判）
	if (!(isMultiJudge && !isChief && !isGuest)) return true;
	// 多審制・非主任・非ゲスト: active prompt が target に完全一致するときのみ
	if (!activePrompt) return false;
	return (
		activePrompt.bib_number === target.bib &&
		String(activePrompt.discipline) === String(target.discipline) &&
		String(activePrompt.level) === String(target.level) &&
		String(activePrompt.event_name) === String(target.eventName)
	);
}

const target: Target = { bib: 12, discipline: 'ski', level: '1', eventName: 'parallel' };
const matchingPrompt: Prompt = {
	bib_number: 12,
	discipline: 'ski',
	level: '1',
	event_name: 'parallel'
};

describe('検定 active-prompt 認可ゲート（M3）', () => {
	it('主任は active prompt 不一致でも採点可（ゲート対象外）', () => {
		expect(
			isScoreAllowed({
				isMultiJudge: true,
				isChief: true,
				isGuest: false,
				activePrompt: { bib_number: 99, discipline: 'x', level: '9', event_name: 'z' },
				target
			})
		).toBe(true);
	});

	it('ゲストは採点可（ゲート対象外）', () => {
		expect(
			isScoreAllowed({
				isMultiJudge: true,
				isChief: false,
				isGuest: true,
				activePrompt: null,
				target
			})
		).toBe(true);
	});

	it('単独審判検定(is_multi_judge=false)は採点可（ゲート対象外）', () => {
		expect(
			isScoreAllowed({
				isMultiJudge: false,
				isChief: false,
				isGuest: false,
				activePrompt: null,
				target
			})
		).toBe(true);
	});

	it('多審制・非主任・非ゲスト: active prompt 一致なら採点可', () => {
		expect(
			isScoreAllowed({
				isMultiJudge: true,
				isChief: false,
				isGuest: false,
				activePrompt: matchingPrompt,
				target
			})
		).toBe(true);
	});

	it('多審制・非主任: active prompt 未設定なら不可', () => {
		expect(
			isScoreAllowed({
				isMultiJudge: true,
				isChief: false,
				isGuest: false,
				activePrompt: null,
				target
			})
		).toBe(false);
	});

	it('多審制・非主任: bib 不一致なら不可', () => {
		expect(
			isScoreAllowed({
				isMultiJudge: true,
				isChief: false,
				isGuest: false,
				activePrompt: { ...matchingPrompt, bib_number: 99 },
				target
			})
		).toBe(false);
	});

	it('多審制・非主任: discipline / level / event_name のいずれか不一致なら不可', () => {
		for (const bad of [
			{ ...matchingPrompt, discipline: 'snowboard' },
			{ ...matchingPrompt, level: '2' },
			{ ...matchingPrompt, event_name: 'moguls' }
		]) {
			expect(
				isScoreAllowed({
					isMultiJudge: true,
					isChief: false,
					isGuest: false,
					activePrompt: bad,
					target
				})
			).toBe(false);
		}
	});
});
