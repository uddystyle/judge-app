-- Supabase Realtime設定のクイック確認スクリプト
-- Supabase Dashboard → SQL Editor にコピー&ペーストして実行

-- ========================================
-- 1. Replica Identity確認
-- ========================================
SELECT
  c.relname as table_name,
  CASE c.relreplident
    WHEN 'd' THEN 'DEFAULT'
    WHEN 'f' THEN 'FULL ✅'
    ELSE 'OTHER ❌'
  END as replica_identity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('training_scores', 'results', 'sessions')
ORDER BY c.relname;

-- 期待される結果: すべてのテーブルで 'FULL ✅' が表示されること
-- もし 'DEFAULT' が表示されている場合、以下のコマンドを実行:
-- ALTER TABLE training_scores REPLICA IDENTITY FULL;
-- ALTER TABLE results REPLICA IDENTITY FULL;
-- ALTER TABLE sessions REPLICA IDENTITY FULL;
