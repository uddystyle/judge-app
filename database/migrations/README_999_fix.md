# Migration 999: RLS Realtime Security Fix

## 概要

このマイグレーションは、Supabase Realtimeのセキュリティ脆弱性を修正します。

## 修正内容

### 1. training_scores テーブル

**修正前（脆弱）**:
```sql
CREATE POLICY "Anonymous users can view training scores"
  ON training_scores FOR SELECT
  TO anon
  USING (true);  -- ❌ 全てのデータが見える
```

**修正後（セキュア）**:
```sql
CREATE POLICY "Anonymous users can view training scores in their sessions"
  ON training_scores FOR SELECT
  TO anon
  USING (
    event_id IN (
      SELECT te.id
      FROM training_events te
      JOIN sessions s ON s.id = te.session_id
      WHERE s.id IN (
        SELECT session_id
        FROM session_participants
        WHERE is_guest = true
      )
    )
  );
```

### 2. results テーブル

**⚠️ 重要**: `results`テーブルは`judge_id`（UUID）ではなく、**`judge_name`（文字列）**を使用しています。

**修正前（脆弱）**:
```sql
CREATE POLICY "Authenticated users can view results"
  ON results FOR SELECT
  TO authenticated
  USING (true);  -- ❌ 全てのデータが見える
```

**修正後（セキュア）**:
```sql
CREATE POLICY "Authenticated users can view results in their sessions"
  ON results FOR SELECT
  TO authenticated
  USING (
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  );
```

**UPDATE ポリシー**:
```sql
CREATE POLICY "Authenticated users can update their own results"
  ON results FOR UPDATE
  TO authenticated
  USING (
    judge_name IN (
      SELECT full_name
      FROM profiles
      WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    judge_name IN (
      SELECT full_name
      FROM profiles
      WHERE id = auth.uid()
    )
  );
```

## 実行方法

### Supabase CLI

```bash
supabase db push
```

### 直接SQL実行

```bash
psql $DATABASE_URL -f database/migrations/999_fix_rls_realtime_security.sql
```

### Supabase Dashboard

1. SQL Editor を開く
2. ファイルの内容を貼り付け
3. 実行

## 検証

```bash
# RLSセキュリティを検証
psql $DATABASE_URL -f scripts/verify-rls-security.sql
```

**期待される出力**:
```
Security Score: 18 / 20 (90.0 %)
✅ Excellent: Your RLS security is well configured!
```

## エラー対応

### エラー: column "judge_id" does not exist

**原因**: `results`テーブルに`judge_id`カラムが存在しない

**解決済み**: このマイグレーションでは`judge_name`を使用するように修正済み

### エラー: policy already exists

**原因**: 既存のポリシーが残っている

**対応**: マイグレーションファイルの冒頭で既存ポリシーを削除しています
```sql
DROP POLICY IF EXISTS "Authenticated users can view results" ON results;
DROP POLICY IF EXISTS "Authenticated users can insert results" ON results;
-- ...
```

## テーブルスキーマの違い

### training_scores（研修モード）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | bigint | 主キー |
| judge_id | UUID | 認証ユーザーのID（auth.uid()） |
| guest_identifier | text | ゲストユーザーの識別子 |
| event_id | bigint | イベントID |
| athlete_id | bigint | 選手ID |
| score | numeric | スコア |

### results（大会モード）

| カラム | 型 | 説明 |
|--------|-----|------|
| id | bigint | 主キー |
| session_id | bigint | セッションID |
| judge_name | text | **検定員名（文字列）** |
| bib | integer | ゼッケン番号 |
| discipline | text | 種目 |
| level | text | 級 |
| event_name | text | イベント名 |
| score | numeric | スコア |

**重要な違い**:
- `training_scores`: `judge_id`（UUID）を使用
- `results`: `judge_name`（文字列）を使用

## 影響範囲

### 変更されるポリシー

- `training_scores`: 1ポリシー（SELECT for anon）
- `results`: 4ポリシー（SELECT/INSERT/UPDATE for authenticated, SELECT for anon）

### 影響を受けないもの

- 既存のデータ（データは変更されません）
- アプリケーションコード（クライアント側の変更不要）
- 他のテーブル

### パフォーマンス影響

- **ほぼなし**: サブクエリはインデックスを使用
- **推奨インデックス**:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_session_participants_user_id
  ON session_participants(user_id);

  CREATE INDEX IF NOT EXISTS idx_session_participants_session_id
  ON session_participants(session_id);

  CREATE INDEX IF NOT EXISTS idx_profiles_id_full_name
  ON profiles(id, full_name);
  ```

## ロールバック

緊急時にロールバックが必要な場合:

```sql
-- training_scores: 元のポリシーに戻す（非推奨）
DROP POLICY IF EXISTS "Anonymous users can view training scores in their sessions" ON training_scores;
CREATE POLICY "Anonymous users can view training scores"
  ON training_scores FOR SELECT
  TO anon
  USING (true);

-- results: 元のポリシーに戻す（非推奨）
DROP POLICY IF EXISTS "Authenticated users can view results in their sessions" ON results;
CREATE POLICY "Authenticated users can view results"
  ON results FOR SELECT
  TO authenticated
  USING (true);
```

**警告**: ロールバックすると再びセキュリティ脆弱性が発生します。

## 参考資料

- [REALTIME_SECURITY.md](../../REALTIME_SECURITY.md) - 詳細なセキュリティガイド
- [SECURITY_CHECKLIST.md](../../SECURITY_CHECKLIST.md) - デプロイ前チェックリスト
- [scripts/verify-rls-security.sql](../../scripts/verify-rls-security.sql) - 検証スクリプト

---

**作成日**: 2026-03-11
**重要度**: 🚨 CRITICAL SECURITY FIX
**必須**: 本番環境デプロイ前に必ず実行
