# package.jsonスクリプト追加手順

テストを実行するために、以下のスクリプトを`package.json`に追加してください。

---

## 推奨スクリプト

`package.json`の`scripts`セクションに以下を追加:

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",

    // 既存のテストスクリプト
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",

    // ✅ 追加: Realtimeテスト用スクリプト
    "test:unit": "vitest run src/lib/tests",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug",
    "test:all": "npm run test:unit && npm run test:integration && npm run test:e2e"
  }
}
```

---

## スクリプトの説明

### ユニットテスト

```bash
# ユニットテストのみ実行（高速）
npm run test:unit

# または既存のコマンド
npm run test
```

### 統合テスト

```bash
# 実際のSupabaseに接続してテスト
npm run test:integration
```

**前提条件**: `.env.test`ファイルにSupabase接続情報が設定されていること

### E2Eテスト

```bash
# E2Eテストを実行
npm run test:e2e

# UIモードで実行（推奨 - 視覚的に確認できる）
npm run test:e2e:ui

# デバッグモード
npm run test:e2e:debug
```

**前提条件**:
- アプリケーションが起動していること (`npm run dev`)
- Playwrightがインストールされていること (`npx playwright install`)

### すべてのテスト

```bash
# ユニット → 統合 → E2Eの順に実行
npm run test:all
```

---

## 既存のスクリプトとの互換性

既存の`npm run test`は引き続き使用できます。これは全ユニットテストを実行します。

---

## Playwright（E2Eテスト）のセットアップ

### 初回のみ実行

```bash
# Playwrightをインストール
npm install -D @playwright/test

# ブラウザをインストール
npx playwright install
```

### playwright.config.tsの作成

プロジェクトルートに`playwright.config.ts`を作成:

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

---

## 使用例

### 開発中のテスト

```bash
# ユニットテストをwatch mode for実行
npm run test:watch

# または
npm run test:ui
```

### CI/CD

```bash
# すべてのテストを実行（カバレッジ付き）
npm run test:coverage
npm run test:integration
npm run test:e2e
```

### デバッグ

```bash
# 特定のテストのみ実行
npm run test:unit -- -t "Realtimeチャンネル接続"

# E2Eテストをデバッグモードで実行
npm run test:e2e:debug
```

---

## トラブルシューティング

### Playwrightが見つからない

```bash
npm install -D @playwright/test
npx playwright install
```

### vitestが見つからない

```bash
npm install -D vitest @vitest/ui
```

### E2Eテストがタイムアウトする

開発サーバーが起動しているか確認:
```bash
# 別のターミナルで
npm run dev

# E2Eテストを実行
npm run test:e2e
```

---

## 次のステップ

1. 上記のスクリプトを`package.json`に追加
2. `npm run test:unit`を実行して動作確認
3. `REALTIME_TEST_SUMMARY.md`を参照してテストを実施

---

**最終更新**: 2026-03-11
