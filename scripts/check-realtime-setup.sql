-- ============================================
-- Supabase Realtime設定の確認スクリプト
-- ============================================

\echo '=========================================='
\echo 'Step 1: Realtime Publication確認'
\echo '=========================================='

SELECT
  tablename,
  CASE
    WHEN tablename IN (
      SELECT tablename
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
    ) THEN '✅ 有効'
    ELSE '❌ 無効'
  END as realtime_status
FROM (
  VALUES ('training_scores'), ('results'), ('sessions')
) AS required_tables(tablename)
ORDER BY tablename;

\echo ''
\echo '=========================================='
\echo 'Step 2: Replica Identity確認'
\echo '=========================================='

SELECT
  c.relname as table_name,
  CASE c.relreplident
    WHEN 'd' THEN '⚠️  DEFAULT (primary key only)'
    WHEN 'n' THEN '❌ NOTHING'
    WHEN 'f' THEN '✅ FULL (recommended)'
    WHEN 'i' THEN '⚠️  INDEX'
  END as replica_identity,
  CASE c.relreplident
    WHEN 'f' THEN '推奨設定です'
    WHEN 'd' THEN 'DELETE時にold値が一部取得できません'
    ELSE '設定を変更してください'
  END as note
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('training_scores', 'results', 'sessions')
ORDER BY c.relname;

\echo ''
\echo '=========================================='
\echo 'Step 3: RLSポリシー確認'
\echo '=========================================='

SELECT
  tablename,
  policyname,
  CASE cmd
    WHEN 'SELECT' THEN '✅ SELECT'
    WHEN 'INSERT' THEN 'INSERT'
    WHEN 'UPDATE' THEN 'UPDATE'
    WHEN 'DELETE' THEN 'DELETE'
    ELSE cmd
  END as command,
  CASE permissive
    WHEN 'PERMISSIVE' THEN 'PERMISSIVE'
    ELSE 'RESTRICTIVE'
  END as type
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('training_scores', 'results', 'sessions')
ORDER BY tablename, cmd;

\echo ''
\echo '=========================================='
\echo '総合診断'
\echo '=========================================='

DO $$
DECLARE
  all_published BOOLEAN;
  all_full_identity BOOLEAN;
  has_select_policies BOOLEAN;
BEGIN
  -- Realtimeが有効かチェック
  SELECT
    COUNT(*) = 3
  INTO all_published
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND tablename IN ('training_scores', 'results', 'sessions');

  -- Replica IdentityがすべてFULLかチェック
  SELECT
    COUNT(*) = 3
  INTO all_full_identity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('training_scores', 'results', 'sessions')
    AND c.relreplident = 'f';

  -- SELECTポリシーが存在するかチェック
  SELECT
    COUNT(*) > 0
  INTO has_select_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('training_scores', 'results', 'sessions')
    AND cmd = 'SELECT';

  -- 結果表示
  IF all_published AND all_full_identity AND has_select_policies THEN
    RAISE NOTICE '✅ すべての設定が完了しています！';
    RAISE NOTICE '';
    RAISE NOTICE '次のステップ:';
    RAISE NOTICE '1. アプリケーションを起動してください';
    RAISE NOTICE '2. ブラウザのDevToolsコンソールを開いてください';
    RAISE NOTICE '3. スコア監視ページを開いて接続ログを確認してください';
  ELSE
    RAISE WARNING '❌ 設定が不完全です:';
    IF NOT all_published THEN
      RAISE WARNING '  - Realtime publicationが未設定です';
    END IF;
    IF NOT all_full_identity THEN
      RAISE WARNING '  - Replica Identityが未設定です (FULLを推奨)';
    END IF;
    IF NOT has_select_policies THEN
      RAISE WARNING '  - RLS SELECTポリシーが未設定です';
    END IF;
    RAISE WARNING '';
    RAISE WARNING '修正方法: REALTIME_SETUP.mdを参照してください';
  END IF;
END $$;
