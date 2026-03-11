# Realtime機能のテストガイド

このディレクトリには、Supabase Realtimeを使用した複数検定員モードのテストが含まれています。

---

## テストの種類

### 1. ユニットテスト（Unit Tests）

**場所**: `src/lib/tests/realtime-score-monitoring.test.ts`

**内容**:
- Supabase Realtimeのモックを使用
- チャンネル接続、イベント受信のテスト
- N+1問題の検証
- パフォーマンステスト（モック環境）

**実行方法**:
```bash
npm run test
# または
npm run test:unit
```

**対象**:
- ✅ Realtimeチャンネル接続
- ✅ INSERT/UPDATE/DELETEイベント受信
- ✅ 複数検定員の同時採点シミュレーション
- ✅ N+1問題が解決されているか
- ✅ パフォーマンス（100人の検定員）

---

### 2. 統合テスト（Integration Tests）

**場所**: `tests/integration/realtime-multi-judge.integration.test.ts`

**内容**:
- 実際のSupabaseに接続
- Realtime機能の動作確認
- データベース設定の検証

**前提条件**:
1. `.env.test`ファイルを作成
2. Supabase接続情報を設定

```.env.test
TEST_SUPABASE_URL=https://your-project.supabase.co
TEST_SUPABASE_ANON_KEY=your-anon-key
TEST_SESSION_ID=test-session-id
TEST_EVENT_ID=test-event-id
TEST_ATHLETE_ID=test-athlete-id
```

**実行方法**:
```bash
npm run test:integration
```

**対象**:
- ✅ training_scores, results, sessionsへのRealtime接続
- ✅ WebSocket接続時間の測定
- ✅ Realtime publication設定の確認

**注意**:
- 実際のデータベースに接続します
- テスト用のセッションを事前に作成してください

---

### 3. E2Eテスト（End-to-End Tests）

**場所**: `tests/e2e/multi-judge-realtime.spec.ts`

**内容**:
- Playwrightを使用
- 複数ブラウザでの同時操作
- 実際のUIでのリアルタイム更新確認

**前提条件**:
1. アプリケーションが起動していること
2. テストユーザーが作成されていること

```.env.test
BASE_URL=http://localhost:5173
TEST_CHIEF_EMAIL=chief@example.com
TEST_CHIEF_PASSWORD=password
TEST_JUDGE1_EMAIL=judge1@example.com
TEST_JUDGE1_PASSWORD=password
TEST_JUDGE2_EMAIL=judge2@example.com
TEST_JUDGE2_PASSWORD=password
```

**実行方法**:
```bash
# 開発サーバーを起動
npm run dev

# 別のターミナルでE2Eテストを実行
npm run test:e2e

# UIモードで実行（推奨）
npm run test:e2e:ui
```

**対象**:
- ✅ 複数検定員の同時スコア入力
- ✅ リアルタイムスコア反映（0.5秒以内）
- ✅ 修正要求の検知と自動遷移
- ✅ セッション終了の検知
- ✅ スコアボードのリアルタイム更新

---

## テストスクリプトの追加

`package.json`に以下のスクリプトを追加してください:

```json
{
  "scripts": {
    "test": "vitest",
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

## クイックスタート

### 1. 依存関係のインストール

```bash
# Vitest（ユニット・統合テスト）
npm install -D vitest

# Playwright（E2Eテスト）
npm install -D @playwright/test
npx playwright install
```

### 2. ユニットテストの実行

```bash
npm run test:unit
```

**期待される出力**:
```
✓ src/lib/tests/realtime-score-monitoring.test.ts (15)
  ✓ Realtimeチャンネル接続 (3)
    ✓ チャンネルに正常に接続できる
    ✓ 複数のチャンネルを同時に接続できる
    ✓ チャンネルを削除できる
  ✓ スコアINSERTイベント (3)
    ✓ 新しいスコアがリアルタイムで追加される
    ✓ 複数の検定員が同時にスコアを入力できる
    ✓ ゲスト検定員のスコアも受信できる
  ...

Test Files  1 passed (1)
     Tests  15 passed (15)
```

### 3. 統合テストの実行（オプション）

```bash
# .env.testを作成
cp .env.example .env.test
# TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEYを設定

# テスト実行
npm run test:integration
```

### 4. E2Eテストの実行（推奨）

```bash
# 開発サーバーを起動
npm run dev

# 別のターミナルで
npm run test:e2e:ui
```

Playwrightのテストランナーが起動し、視覚的にテストを確認できます。

---

## CI/CD統合

### GitHub Actions

`.github/workflows/test.yml`:

```yaml
name: Tests

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:unit

  integration-tests:
    runs-on: ubuntu-latest
    env:
      TEST_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
      TEST_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:integration

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run build
      - run: npm run preview &
      - run: npm run test:e2e
```

---

## トラブルシューティング

### 問題1: ユニットテストが失敗する

**症状**:
```
TypeError: Cannot read properties of undefined
```

**原因**: Vitestの設定が不足

**対策**:
`vite.config.ts`にテスト設定を追加:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom'
  }
});
```

---

### 問題2: 統合テストがタイムアウトする

**症状**:
```
Error: Subscription timeout
```

**原因**: Supabase Realtimeが有効化されていない

**対策**:
1. Supabase Dashboard → Database → Replication → Publications
2. `training_scores`, `results`, `sessions`を確認
3. `REALTIME_SETUP.md`の手順を実行

---

### 問題3: E2Eテストでログインできない

**症状**:
```
Timeout: locator.waitForURL
```

**原因**: テストユーザーが存在しない、またはパスワードが間違っている

**対策**:
1. Supabase Dashboardでテストユーザーを作成
2. `.env.test`の認証情報を確認
3. ローカル環境で手動ログインできるか確認

---

## テストのベストプラクティス

### 1. ユニットテスト

✅ **DO**:
- モックを使用して高速に実行
- 1つのテストで1つの機能を確認
- テストの独立性を保つ

❌ **DON'T**:
- 実際のAPIに接続しない
- テスト間で状態を共有しない

### 2. 統合テスト

✅ **DO**:
- テスト専用のデータベースを使用
- テスト後にデータをクリーンアップ
- タイムアウトを適切に設定

❌ **DON'T**:
- 本番データベースを使用しない
- 他のテストに影響を与えない

### 3. E2Eテスト

✅ **DO**:
- ユーザーの実際の操作フローをテスト
- 視覚的なフィードバックを確認
- 複数ブラウザでの同時操作をテスト

❌ **DON'T**:
- 内部実装の詳細をテストしない
- テストが脆くならないようにする

---

## 参考資料

- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [Supabase Realtime Testing](https://supabase.com/docs/guides/realtime/testing)
- `TESTING_GUIDE.md` - 手動テストガイド
- `VERIFICATION_CHECKLIST.md` - 動作確認チェックリスト

---

## よくある質問

### Q1: テストの実行時間が長いです

A: ユニットテストのみを実行してください:
```bash
npm run test:unit
```

### Q2: E2Eテストをスキップしたいです

A: `test.skip()`を使用:
```typescript
test.skip('テスト名', async () => {
  // テストコード
});
```

### Q3: 特定のテストのみ実行したいです

A: `-t`オプションを使用:
```bash
npm run test:unit -- -t "Realtimeチャンネル接続"
npm run test:e2e -- -g "複数検定員"
```

---

**最終更新**: 2026-03-11
**作成者**: Claude Opus 4.5
