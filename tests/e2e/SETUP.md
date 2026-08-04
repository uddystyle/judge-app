# E2Eテストのセットアップ手順

## 1. Playwrightのインストール

```bash
npm install -D @playwright/test
npx playwright install
```

## 2. テストユーザーの作成

Supabase Studioまたはpsqlで以下のユーザーを作成してください：

```sql
-- 主任検定員
INSERT INTO auth.users (email, encrypted_password, email_confirmed_at)
VALUES (
  'chief@example.com',
  crypt('password', gen_salt('bf')),
  now()
);

-- 一般検定員1
INSERT INTO auth.users (email, encrypted_password, email_confirmed_at)
VALUES (
  'judge1@example.com',
  crypt('password', gen_salt('bf')),
  now()
);

-- 一般検定員2
INSERT INTO auth.users (email, encrypted_password, email_confirmed_at)
VALUES (
  'judge2@example.com',
  crypt('password', gen_salt('bf')),
  now()
);
```

## 3. 環境変数の設定

`.env.test`ファイルを作成：

```bash
# テストユーザーのクレデンシャル
TEST_CHIEF_EMAIL=chief@example.com
TEST_CHIEF_PASSWORD=password
TEST_JUDGE1_EMAIL=judge1@example.com
TEST_JUDGE1_PASSWORD=password
TEST_JUDGE2_EMAIL=judge2@example.com
TEST_JUDGE2_PASSWORD=password

# Realtime/polling E2E用（一般検定員が参加済みの待機中セッション）
TEST_JUDGE_EMAIL=judge1@example.com
TEST_JUDGE_PASSWORD=password
TEST_REALTIME_SESSION_ID=00000000-0000-0000-0000-000000000000

# ベースURL
BASE_URL=http://localhost:5173
```

`TEST_REALTIME_SESSION_ID` のセッションは、次の状態にしてください。

- `status = 'active'`、`is_active = true`
- `active_prompt_id IS NULL`
- `TEST_JUDGE_EMAIL` の一般検定員が参加済み

値が未設定の場合、`realtime-polling-behavior.spec.ts` は理由を表示してskipします。

## 4. 開発サーバーの起動

```bash
npm run dev
```

別のターミナルでE2Eテストを実行：

```bash
npm run test:e2e
```

## 5. 初回実行時の注意

- Playwrightが自動的にブラウザをダウンロードします（約300MB）
- テスト実行前に開発サーバーが完全に起動していることを確認してください
- テスト実行時は他のブラウザタブを閉じることを推奨します

## トラブルシューティング

### エラー: "Playwright not found"

```bash
npx playwright install
```

### エラー: "Page timeout"

- 開発サーバーが起動しているか確認
- ベースURLが正しいか確認（デフォルト: http://localhost:5173）

### エラー: "Login failed"

- テストユーザーがデータベースに存在するか確認
- パスワードが正しいか確認
