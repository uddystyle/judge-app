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

## 研修モード機能追加（004_add_training_mode.sql）

### 概要

このマイグレーションは、研修モード機能をサポートするために以下の変更を加えます：

1. **sessionsテーブルの拡張**
   - `mode`: セッションモード（'certification', 'tournament', 'training'）

2. **training_sessionsテーブルの追加**
   - 研修モード固有の設定を管理
   - 主任検定員（chief_judge_id）の設定
   - 表示設定（個別採点表示、比較表示、偏差分析）
   - 最大検定員数（デフォルト100名）

3. **training_eventsテーブルの追加**
   - 研修モード用の種目を管理
   - 採点範囲（最小・最大）と精度設定
   - リアルタイム採点用の現在の選手ID

4. **training_scoresテーブルの追加**
   - 検定員ごとの個別採点データを保存
   - 集計なしで全採点を保持

### 実行方法

#### 方法1: Supabaseダッシュボードから実行（推奨）

1. Supabaseダッシュボードにログイン
2. プロジェクトを選択
3. 左サイドバーから「SQL Editor」を選択
4. 「New query」をクリック
5. `database/migrations/004_add_training_mode.sql` の内容をコピー＆ペースト
6. 「Run」をクリックして実行

#### 方法2: Supabase CLIから実行

```bash
# Supabase CLIがインストールされている場合
supabase db push database/migrations/004_add_training_mode.sql

# または直接SQLファイルを実行
psql $DATABASE_URL -f database/migrations/004_add_training_mode.sql
```

### 実行後の確認

マイグレーションが正常に実行されたか確認します：

```bash
# 検証スクリプトを実行
psql $DATABASE_URL -f database/migrations/004_verify_training_mode.sql
```

または、Supabase Studioで以下のSQLを実行:

```sql
-- sessions.mode カラムの確認
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'sessions' AND column_name = 'mode';

-- 新しいテーブルが作成されているか確認
SELECT table_name
FROM information_schema.tables
WHERE table_name IN ('training_sessions', 'training_events', 'training_scores')
  AND table_schema = 'public';

-- RLSポリシーが設定されているか確認
SELECT tablename, COUNT(*) as policy_count
FROM pg_policies
WHERE tablename IN ('training_sessions', 'training_events', 'training_scores')
GROUP BY tablename;
```

期待される結果:
- `training_sessions`: 4 policies
- `training_events`: 4 policies
- `training_scores`: 4 policies

### ロールバック

もしマイグレーションを元に戻す必要がある場合：

**⚠️ 警告: ロールバックすると、研修モード関連のデータが全て削除されます！**

```bash
# Supabaseダッシュボードで実行
# database/migrations/004_add_training_mode_rollback.sql の内容を実行
```

### 影響範囲

このマイグレーションは以下に影響します：

- ✅ 既存の検定モード・大会モードの機能には影響なし（後方互換性あり）
- ✅ 既存のsessionsテーブルのレコードは `mode='certification'` または `mode='tournament'` として自動的に更新される
- ✅ 新しいテーブルは空の状態で作成される

### テストデータの投入（オプション）

開発環境でテストする場合、以下のSQLでテストデータを投入できます：

```sql
-- 1. テスト用セッションを作成（研修モード）
INSERT INTO sessions (name, mode, created_by)
VALUES ('テスト研修セッション', 'training', auth.uid())
RETURNING id;

-- 2. training_sessions を作成（上記のセッションIDを使用）
INSERT INTO training_sessions (session_id, max_judges)
VALUES (1, 100); -- セッションID 1 を使用

-- 3. 参加者を追加（検定員 + 選手）
INSERT INTO participants (session_id, bib_number, athlete_name)
VALUES
  (1, 1, 'テスト検定員1'),
  (1, 2, 'テスト検定員2'),
  (1, 3, 'テスト検定員3'),
  (1, 101, 'テスト選手1'),
  (1, 102, 'テスト選手2');

-- 4. 主任検定員を設定（検定員1を主任に）
UPDATE training_sessions
SET chief_judge_id = (SELECT id FROM participants WHERE session_id = 1 AND bib_number = 1)
WHERE session_id = 1;

-- 5. 研修種目を作成
INSERT INTO training_events (session_id, name, order_index, min_score, max_score, score_precision)
VALUES
  (1, '基本技', 1, 0, 10, 1),
  (1, '応用技', 2, 0, 10, 1)
RETURNING id;

-- 6. テスト採点データを挿入
-- event_id 1, 検定員1が選手101を採点
INSERT INTO training_scores (event_id, judge_id, athlete_id, score, is_finalized)
VALUES
  (1, 1, 4, 8.5, true),  -- judge_id=1 (検定員1), athlete_id=4 (選手101)
  (1, 2, 4, 8.0, true),  -- judge_id=2 (検定員2), athlete_id=4 (選手101)
  (1, 3, 4, 9.0, true);  -- judge_id=3 (検定員3), athlete_id=4 (選手101)
```

### 採点マトリックスの確認

```sql
-- 選手×検定員の採点マトリックスを表示
SELECT
  athletes.athlete_name,
  judges.athlete_name as judge_name,
  ts.score
FROM training_scores ts
JOIN participants athletes ON ts.athlete_id = athletes.id
JOIN participants judges ON ts.judge_id = judges.id
WHERE ts.event_id = 1
ORDER BY athletes.athlete_name, judges.athlete_name;
```

期待される出力:
```
athlete_name | judge_name      | score
-------------|-----------------|------
テスト選手1  | テスト検定員1   | 8.5
テスト選手1  | テスト検定員2   | 8.0
テスト選手1  | テスト検定員3   | 9.0
```

### トラブルシューティング

#### エラー: "constraint already exists"

既に制約が存在する場合:

```sql
-- 既存の制約を削除してから再実行
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS valid_session_mode;
```

#### エラー: "column mode already exists"

既にmodeカラムが存在する場合は、`IF NOT EXISTS` が使用されているため問題ありませんが、データ型を確認してください:

```sql
-- mode カラムのデータ型を確認
SELECT data_type FROM information_schema.columns
WHERE table_name = 'sessions' AND column_name = 'mode';

-- text 型であることを確認
```

#### エラー: "function update_updated_at_column() does not exist"

001_add_tournament_mode.sql が実行されていない場合:

```sql
-- update_updated_at_column 関数を作成
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';
```

### 次のステップ

マイグレーション実行後：

1. ✅ フェーズ2: セッション作成画面でモード選択を追加（研修モードオプション）
2. ✅ フェーズ3: 主任検定員選択機能の実装
3. ✅ フェーズ4: 研修種目管理画面の実装
4. ✅ フェーズ5: 採点フロー（主任検定員・検定員）の実装
5. ✅ フェーズ6: スコアボード（マトリックス形式）の実装

詳細は [Plan.md - 研修モード実装計画](../../Plan.md#研修モード実装計画) を参照してください。

---

## サポート

問題が発生した場合は、以下を確認してください：

1. Supabaseダッシュボードの「Logs」でエラーを確認
2. RLSポリシーが正しく設定されているか確認
3. `auth.uid()` が正しく動作しているか確認
4. マイグレーション順序が正しいか確認（001 → 002 → 003 → 004）
