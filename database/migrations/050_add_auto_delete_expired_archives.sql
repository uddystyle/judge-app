-- ============================================================
-- Migration 050: 期限切れアーカイブの自動削除機能
-- ============================================================
-- 実行日: 2025-11-23
-- 説明: サブスクリプションプラン別の保持期間を超えたアーカイブデータを自動削除
-- ============================================================

-- ============================================================
-- 1. 期限切れアーカイブセッションを削除する関数
-- ============================================================

CREATE OR REPLACE FUNCTION delete_expired_archived_sessions()
RETURNS TABLE (
  deleted_session_id UUID,
  organization_id UUID,
  organization_name TEXT,
  session_name TEXT,
  deleted_at TIMESTAMPTZ,
  retention_days INTEGER
) AS $$
DECLARE
  session_record RECORD;
  deleted_count INTEGER := 0;
BEGIN
  -- 削除対象のセッションを特定（ログ用）
  FOR session_record IN
    SELECT
      s.id AS session_id,
      s.name AS session_name,
      s.deleted_at,
      s.organization_id,
      o.name AS org_name,
      p.archived_data_retention_days AS retention_days
    FROM sessions s
    INNER JOIN organizations o ON s.organization_id = o.id
    INNER JOIN plans p ON o.plan_type = p.plan_type
    WHERE
      -- アーカイブ済み（deleted_at が NULL でない）
      s.deleted_at IS NOT NULL
      -- 無制限保持でない（Premium プラン以外）
      AND p.archived_data_retention_days != -1
      -- 保持期間を超過している
      AND s.deleted_at + (p.archived_data_retention_days || ' days')::INTERVAL < NOW()
  LOOP
    -- 関連データの削除

    -- 1. session_participants の削除
    DELETE FROM session_participants
    WHERE session_id = session_record.session_id;

    -- 2. scores の削除
    DELETE FROM scores
    WHERE session_id = session_record.session_id;

    -- 3. training_sessions の削除（存在する場合）
    DELETE FROM training_sessions
    WHERE session_id = session_record.session_id;

    -- 4. tournament_rounds の削除（存在する場合）
    DELETE FROM tournament_rounds
    WHERE session_id = session_record.session_id;

    -- 5. scoring_prompts の削除（存在する場合）
    DELETE FROM scoring_prompts
    WHERE session_id = session_record.session_id;

    -- 6. custom_events の削除（存在する場合）
    DELETE FROM custom_events
    WHERE session_id = session_record.session_id;

    -- 7. セッション本体の削除
    DELETE FROM sessions
    WHERE id = session_record.session_id;

    -- 削除ログを返す
    deleted_session_id := session_record.session_id;
    organization_id := session_record.organization_id;
    organization_name := session_record.org_name;
    session_name := session_record.session_name;
    deleted_at := session_record.deleted_at;
    retention_days := session_record.retention_days;

    deleted_count := deleted_count + 1;

    RETURN NEXT;
  END LOOP;

  -- ログ出力
  RAISE NOTICE '期限切れアーカイブセッション削除完了: % 件のセッションを削除しました', deleted_count;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 関数の説明コメント
COMMENT ON FUNCTION delete_expired_archived_sessions() IS
'プラン別の保持期間を超過したアーカイブセッションを自動削除する関数。
Premiumプラン（retention_days = -1）は無制限保持のため削除されない。
削除されたセッションの情報をテーブル形式で返す。';

-- ============================================================
-- 2. 削除実行ログテーブルの作成（オプション）
-- ============================================================

CREATE TABLE IF NOT EXISTS archive_deletion_logs (
  id BIGSERIAL PRIMARY KEY,
  execution_time TIMESTAMPTZ DEFAULT NOW(),
  deleted_count INTEGER NOT NULL,
  execution_duration_ms INTEGER, -- 実行時間（ミリ秒）
  details JSONB -- 削除されたセッションの詳細情報
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_archive_deletion_logs_execution_time
  ON archive_deletion_logs(execution_time DESC);

-- RLS設定（管理者のみ閲覧可能）
ALTER TABLE archive_deletion_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only superusers can view deletion logs"
  ON archive_deletion_logs FOR SELECT
  TO authenticated
  USING (
    -- Supabase環境ではservice_roleのみがアクセス可能
    auth.jwt() ->> 'role' = 'service_role'
  );

-- ============================================================
-- 3. ログ付き削除実行ラッパー関数
-- ============================================================

CREATE OR REPLACE FUNCTION execute_archive_cleanup()
RETURNS JSONB AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
  deleted_sessions JSONB;
  deleted_count INTEGER := 0;
BEGIN
  start_time := clock_timestamp();

  -- 削除実行と結果の取得
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'session_id', deleted_session_id,
        'organization_id', organization_id,
        'organization_name', organization_name,
        'session_name', session_name,
        'deleted_at', deleted_at,
        'retention_days', retention_days
      )
    ),
    COUNT(*)
  INTO deleted_sessions, deleted_count
  FROM delete_expired_archived_sessions();

  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  -- ログテーブルに記録
  INSERT INTO archive_deletion_logs (deleted_count, execution_duration_ms, details)
  VALUES (deleted_count, duration_ms, deleted_sessions);

  -- 結果を返す
  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', deleted_count,
    'execution_time', start_time,
    'duration_ms', duration_ms,
    'details', COALESCE(deleted_sessions, '[]'::jsonb)
  );

EXCEPTION
  WHEN OTHERS THEN
    -- エラー発生時のログ記録
    INSERT INTO archive_deletion_logs (deleted_count, execution_duration_ms, details)
    VALUES (
      0,
      EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time))::INTEGER,
      jsonb_build_object(
        'error', true,
        'message', SQLERRM,
        'detail', SQLSTATE
      )
    );

    -- エラーを返す
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION execute_archive_cleanup() IS
'期限切れアーカイブの削除を実行し、実行結果をログテーブルに記録する。
Cron ジョブから呼び出すことを想定している。
実行結果をJSON形式で返す。';

-- ============================================================
-- 完了
-- ============================================================
-- マイグレーション完了！
-- 次のステップ: Supabase Cron ジョブの設定
--
-- Cronジョブ設定例（Supabase Dashboard > Database > Cron Jobs）:
-- 名前: daily_archive_cleanup
-- スケジュール: 0 2 * * * (毎日午前2時)
-- コマンド: SELECT execute_archive_cleanup();
-- ============================================================
