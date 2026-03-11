-- ============================================
-- Supabase Realtime設定の自動適用スクリプト
-- ============================================

\echo '=========================================='
\echo 'Supabase Realtime設定を適用します'
\echo '=========================================='
\echo ''

-- Step 1: Realtime Publicationに追加
\echo 'Step 1: Realtime Publicationへの追加中...'

DO $$
BEGIN
  -- training_scores
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'training_scores'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE training_scores;
    RAISE NOTICE '✅ training_scores を追加しました';
  ELSE
    RAISE NOTICE '⏭️  training_scores は既に追加済みです';
  END IF;

  -- results
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE results;
    RAISE NOTICE '✅ results を追加しました';
  ELSE
    RAISE NOTICE '⏭️  results は既に追加済みです';
  END IF;

  -- sessions
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
    RAISE NOTICE '✅ sessions を追加しました';
  ELSE
    RAISE NOTICE '⏭️  sessions は既に追加済みです';
  END IF;
END $$;

\echo ''
\echo 'Step 2: Replica Identityの設定中...'

-- training_scores
ALTER TABLE training_scores REPLICA IDENTITY FULL;
\echo '✅ training_scores のREPLICA IDENTITYをFULLに設定しました'

-- results
ALTER TABLE results REPLICA IDENTITY FULL;
\echo '✅ results のREPLICA IDENTITYをFULLに設定しました'

-- sessions
ALTER TABLE sessions REPLICA IDENTITY FULL;
\echo '✅ sessions のREPLICA IDENTITYをFULLに設定しました'

\echo ''
\echo '=========================================='
\echo '✅ 設定が完了しました！'
\echo '=========================================='
\echo ''
\echo '確認コマンドを実行してください:'
\echo '  psql -f scripts/check-realtime-setup.sql'
\echo ''
