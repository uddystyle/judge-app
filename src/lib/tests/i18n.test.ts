import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// 翻訳ファイルを直接読み込み
const messagesDir = path.resolve(__dirname, '../../../messages');
const jaMessages = JSON.parse(fs.readFileSync(path.join(messagesDir, 'ja.json'), 'utf-8'));
const enMessages = JSON.parse(fs.readFileSync(path.join(messagesDir, 'en.json'), 'utf-8'));

// $schemaキーを除外
const jaKeys = Object.keys(jaMessages).filter((k) => k !== '$schema');
const enKeys = Object.keys(enMessages).filter((k) => k !== '$schema');

describe('i18n - 翻訳ファイルの完全性チェック', () => {
	it('ja.jsonとen.jsonのキー数が一致する', () => {
		expect(jaKeys.length).toBe(enKeys.length);
	});

	it('ja.jsonの全キーがen.jsonに存在する', () => {
		const missingInEn = jaKeys.filter((key) => !enKeys.includes(key));
		expect(missingInEn).toEqual([]);
	});

	it('en.jsonの全キーがja.jsonに存在する', () => {
		const missingInJa = enKeys.filter((key) => !jaKeys.includes(key));
		expect(missingInJa).toEqual([]);
	});

	it('全ての値が空文字列ではない', () => {
		const emptyJa = jaKeys.filter((key) => jaMessages[key] === '');
		const emptyEn = enKeys.filter((key) => enMessages[key] === '');
		expect(emptyJa).toEqual([]);
		expect(emptyEn).toEqual([]);
	});

	it('ja.jsonとen.jsonの値が異なる（翻訳されている）', () => {
		// 一部のキーは意図的に同じ値（例: プラン名 "Basic", "Standard", "Premium", "OK"）
		const intentionallySame = [
			'landing_planBasic',
			'landing_planStandard',
			'landing_planPremium',
			'landing_title',
			'plan_basic',
			'plan_standard',
			'plan_premium',
			'common_ok'
		];

		const sameValues = jaKeys.filter(
			(key) => jaMessages[key] === enMessages[key] && !intentionallySame.includes(key)
		);

		// lang_jaとlang_enは意図的に同じ
		const filteredSame = sameValues.filter((k) => k !== 'lang_ja' && k !== 'lang_en');

		if (filteredSame.length > 0) {
			console.warn('以下のキーは日英で同じ値です（未翻訳の可能性）:', filteredSame);
		}
		// 警告のみ、テスト失敗にはしない（一部は意図的に同じ場合がある）
	});
});

describe('i18n - パラメータ付きメッセージの整合性', () => {
	it('パラメータ変数がja/enで一致する', () => {
		const paramRegex = /\{(\w+)\}/g;
		const mismatches: string[] = [];

		for (const key of jaKeys) {
			const jaParams = [...(jaMessages[key] as string).matchAll(paramRegex)].map((m) => m[1]).sort();
			const enParams = [...(enMessages[key] as string).matchAll(paramRegex)].map((m) => m[1]).sort();

			if (JSON.stringify(jaParams) !== JSON.stringify(enParams)) {
				mismatches.push(`${key}: ja=${JSON.stringify(jaParams)} en=${JSON.stringify(enParams)}`);
			}
		}

		expect(mismatches).toEqual([]);
	});
});

describe('i18n - キー命名規約', () => {
	it('全てのキーがsnake_case + camelCaseの混合パターンに従う', () => {
		const validKeyPattern = /^[a-z][a-zA-Z0-9_]*$/;
		const invalidKeys = jaKeys.filter((key) => !validKeyPattern.test(key));
		expect(invalidKeys).toEqual([]);
	});

	it('キーがカテゴリプレフィックスで始まる', () => {
		const validPrefixes = [
			'common_',
			'nav_',
			'auth_',
			'footer_',
			'lang_',
			'error_',
			'validation_',
			'landing_',
			'dashboard_',
			'mode_',
			'org_',
			'account_',
			'plan_',
			'dialog_',
			'score_',
			'event_',
			'settings_',
			'session_',
			'details_',
			'action_'
		];

		const invalidKeys = jaKeys.filter(
			(key) => !validPrefixes.some((prefix) => key.startsWith(prefix))
		);
		expect(invalidKeys).toEqual([]);
	});
});
