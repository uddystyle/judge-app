/**
 * Vitest セットアップファイル
 *
 * Svelte 5 コンポーネントテストのための環境設定
 */

import '@testing-library/jest-dom/vitest';

// ブラウザ環境のグローバル変数を設定
if (typeof window !== 'undefined') {
	// window.location のモック（必要に応じて）
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => {}
		})
	});
}
