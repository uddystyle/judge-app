# データベースマイグレーション

## 大会モード機能追加（001_add_tournament_mode.sql）

### 概要

このマイグレーションは、大会モード機能をサポートするために以下の変更を加えます：

1. **sessionsテーブルの拡張**
   - `is_tournament_mode`: 大会モードフラグ
   - `score_calculation`: 得点計算方法（'average' または 'sum'）
   - `exclude_extremes`: 最大・最小を除外するか（5審3採用）

2. **custom_eventsテーブルの追加**
   - 大会モード用のカスタム種目を管理

3. **participantsテーブルの追加**
   - 参加者情報を管理（エクスポート用）

### 実行方法

#### 方法1: Supabaseダッシュボードから実行（推奨）

1. Supabaseダッシュボードにログイン
2. プロジェクトを選択
3. 左サイドバーから「SQL Editor」を選択
4. 「New query」をクリック
5. `database/migrations/001_add_tournament_mode.sql` の内容をコピー＆ペースト
6. 「Run」をクリックして実行

#### 方法2: Supabase CLIから実行

```bash
# Supabase CLIがインストールされている場合
supabase db push

# または直接SQLファイルを実行
psql $DATABASE_URL -f database/migrations/001_add_tournament_mode.sql
```

### 実行後の確認

マイグレーションが正常に実行されたか確認します：

```sql
-- sessionsテーブルに新しいカラムが追加されているか確認
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'sessions'
  AND column_name IN ('is_tournament_mode', 'score_calculation', 'exclude_extremes');

-- 新しいテーブルが作成されているか確認
SELECT table_name
FROM information_schema.tables
WHERE table_name IN ('custom_events', 'participants')
  AND table_schema = 'public';

-- RLSポリシーが設定されているか確認
SELECT tablename, policyname
FROM pg_policies
WHERE tablename IN ('custom_events', 'participants');
```

### ロールバック

もしマイグレーションを元に戻す必要がある場合：

**⚠️ 警告: ロールバックすると、カスタム種目と参加者のデータが全て削除されます！**

```bash
# Supabaseダッシュボードで実行
# database/migrations/001_add_tournament_mode_rollback.sql の内容を実行
```

### 影響範囲

このマイグレーションは以下に影響します：

- ✅ 既存の検定モードの機能には影響なし（後方互換性あり）
- ✅ 既存のsessionsテーブルのレコードは `is_tournament_mode=false` として扱われる
- ✅ 新しいテーブルは空の状態で作成される

### テストデータの投入（オプション）

開発環境でテストする場合、以下のSQLでテストデータを投入できます：

```sql
-- テスト用のカスタム種目を追加
INSERT INTO custom_events (session_id, discipline, level, event_name, display_order)
VALUES
  ('your-session-id-here', 'アルペン', '1級', '大回転', 1),
  ('your-session-id-here', 'アルペン', '1級', '回転', 2);

-- テスト用の参加者を追加
INSERT INTO participants (session_id, bib_number, participant_name, team, category)
VALUES
  ('your-session-id-here', 101, '山田太郎', 'A高校', '男子'),
  ('your-session-id-here', 102, '佐藤花子', 'B高校', '女子');
```

### トラブルシューティング

#### エラー: "relation already exists"

既にテーブルが存在する場合は、`IF NOT EXISTS` が使用されているため問題ありません。

#### エラー: "permission denied"

RLSポリシーの問題の可能性があります。Supabaseダッシュボードで実行していることを確認してください。

#### エラー: "constraint already exists"

既に制約が存在する場合は、`DROP CONSTRAINT IF EXISTS` を先に実行してから再度実行してください。

### 次のステップ

マイグレーション実行後：

1. ✅ フェーズ2: セッション作成画面でモード選択を追加
2. ✅ フェーズ3: 大会設定画面の実装
3. ✅ フェーズ4: カスタム種目管理機能の実装

---

## サポート

問題が発生した場合は、以下を確認してください：

1. Supabaseダッシュボードの「Logs」でエラーを確認
2. RLSポリシーが正しく設定されているか確認
3. `auth.uid()` が正しく動作しているか確認
