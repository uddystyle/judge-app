# アーカイブ自動削除の設定ガイド

## 概要

このガイドでは、Supabaseのpg_cron拡張機能を使用して、期限切れのアーカイブセッションを自動的に削除するCronジョブの設定方法を説明します。

## 前提条件

以下のマイグレーションが実行済みであること:
- `049_add_plans_table_with_retention.sql` - プランテーブルと保持期間の追加
- `050_add_auto_delete_expired_archives.sql` - 自動削除関数の作成

## ステップ1: pg_cron拡張機能の有効化

1. Supabaseダッシュボードにログイン
2. **Database** → **Extensions** に移動
3. `pg_cron` を検索して有効化

または、SQL Editorで以下を実行:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

## ステップ2: Cronジョブの作成

### 方法A: Supabaseダッシュボードから設定（推奨）

1. Supabaseダッシュボードで **Database** → **Cron Jobs** に移動
2. **New Cron Job** をクリック
3. 以下の設定を入力:
   - **Name**: `daily_archive_cleanup`
   - **Schedule**: `0 2 * * *` (毎日午前2時に実行)
   - **Command**:
     ```sql
     SELECT execute_archive_cleanup();
     ```
   - **Timezone**: `Asia/Tokyo` (お好みのタイムゾーン)

4. **Create** をクリック

### 方法B: SQLで直接設定

SQL Editorで以下を実行:

```sql
-- 毎日午前2時（JST）に期限切れアーカイブを削除
SELECT cron.schedule(
  'daily_archive_cleanup',           -- ジョブ名
  '0 2 * * *',                       -- Cronスケジュール（毎日午前2時）
  $$SELECT execute_archive_cleanup();$$  -- 実行するSQL
);
```

## ステップ3: 動作確認

### 手動実行テスト

Cronジョブを手動で実行して動作確認:

```sql
-- 関数を直接実行
SELECT execute_archive_cleanup();
```

実行結果の例:
```json
{
  "success": true,
  "deleted_count": 5,
  "execution_time": "2025-11-23T02:00:00Z",
  "duration_ms": 234,
  "details": [
    {
      "session_id": "uuid-here",
      "organization_id": "org-uuid",
      "organization_name": "テストスキークラブ",
      "session_name": "2024年度検定",
      "deleted_at": "2024-08-01T10:00:00Z",
      "retention_days": 30
    }
  ]
}
```

### 削除ログの確認

削除実行履歴を確認:

```sql
SELECT
  id,
  execution_time,
  deleted_count,
  execution_duration_ms,
  details
FROM archive_deletion_logs
ORDER BY execution_time DESC
LIMIT 10;
```

### Cronジョブの実行履歴確認

```sql
-- Cronジョブの実行履歴を確認
SELECT
  jobid,
  jobname,
  schedule,
  command,
  last_run,
  next_run
FROM cron.job
WHERE jobname = 'daily_archive_cleanup';
```

## ステップ4: Cronジョブの管理

### ジョブの停止

```sql
SELECT cron.unschedule('daily_archive_cleanup');
```

### ジョブの再作成

停止後、必要に応じて再度作成:

```sql
SELECT cron.schedule(
  'daily_archive_cleanup',
  '0 2 * * *',
  $$SELECT execute_archive_cleanup();$$
);
```

### スケジュールの変更

```sql
-- ジョブを削除
SELECT cron.unschedule('daily_archive_cleanup');

-- 新しいスケジュールで再作成（例: 毎日午前3時）
SELECT cron.schedule(
  'daily_archive_cleanup',
  '0 3 * * *',
  $$SELECT execute_archive_cleanup();$$
);
```

## プラン別の保持期間

| プラン | 保持期間 | 説明 |
|--------|----------|------|
| Free | 30日 | 削除から30日後に完全削除 |
| Basic | 90日 | 削除から90日後に完全削除 |
| Standard | 180日 | 削除から180日後に完全削除 |
| Premium | 無制限 | 自動削除されない（手動での完全削除のみ） |

## 削除処理の詳細

### 削除される関連データ

Cronジョブは以下のデータを順次削除します:

1. `session_participants` - セッション参加者データ
2. `scores` - スコアデータ
3. `training_sessions` - 研修セッション設定
4. `tournament_rounds` - 大会ラウンドデータ
5. `scoring_prompts` - 採点プロンプト
6. `custom_events` - カスタムイベント
7. `sessions` - セッション本体

### セキュリティ

- 削除関数は `SECURITY DEFINER` として実行されるため、通常のRLSポリシーをバイパスします
- Cronジョブはデータベース内部で実行されるため、外部からの不正実行はできません
- 削除ログは管理者（service_role）のみが閲覧可能です

## トラブルシューティング

### Cronジョブが実行されない

1. pg_cron拡張機能が有効化されているか確認:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```

2. Cronジョブが正しく登録されているか確認:
   ```sql
   SELECT * FROM cron.job;
   ```

3. Supabaseのログを確認（Dashboard → Logs → Postgres Logs）

### 削除が実行されない

削除対象のセッションを確認:

```sql
SELECT
  s.id,
  s.name,
  s.deleted_at,
  o.name AS organization_name,
  o.plan_type,
  p.archived_data_retention_days,
  s.deleted_at + (p.archived_data_retention_days || ' days')::INTERVAL AS expiry_date,
  NOW() AS current_time,
  CASE
    WHEN s.deleted_at + (p.archived_data_retention_days || ' days')::INTERVAL < NOW()
    THEN 'WILL BE DELETED'
    ELSE 'RETAINED'
  END AS status
FROM sessions s
INNER JOIN organizations o ON s.organization_id = o.id
INNER JOIN plans p ON o.plan_type = p.plan_type
WHERE
  s.deleted_at IS NOT NULL
  AND p.archived_data_retention_days != -1
ORDER BY s.deleted_at;
```

## 監視とアラート

### 削除統計の定期確認

月次レポート用クエリ:

```sql
-- 過去30日間の削除統計
SELECT
  DATE(execution_time) AS date,
  SUM(deleted_count) AS total_deleted,
  COUNT(*) AS executions,
  AVG(execution_duration_ms) AS avg_duration_ms
FROM archive_deletion_logs
WHERE execution_time >= NOW() - INTERVAL '30 days'
GROUP BY DATE(execution_time)
ORDER BY date DESC;
```

### 異常検知

削除数が急増した場合の確認:

```sql
-- 削除数が10件以上の実行を抽出
SELECT *
FROM archive_deletion_logs
WHERE deleted_count >= 10
ORDER BY execution_time DESC;
```

## 本番環境での運用推奨事項

1. **初回実行前のバックアップ**: 本番環境で初めてCronジョブを有効化する前に、データベースの完全バックアップを取得

2. **段階的な導入**:
   - まず手動実行でテスト
   - 問題がなければCronジョブを有効化

3. **監視の設定**: 削除ログテーブルを定期的に確認し、異常な削除パターンがないか監視

4. **ユーザー通知**: 削除7日前にメール通知を送信する機能の追加を検討（Phase 6のオプション機能）

## 関連ドキュメント

- [Soft Delete実装計画](/docs/soft-delete-implementation-plan.md)
- [Supabase pg_cron公式ドキュメント](https://supabase.com/docs/guides/database/extensions/pg_cron)
- [PostgreSQL Cron構文](https://crontab.guru/)
