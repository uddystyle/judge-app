-- ============================================
-- Supabase Realtime設定の確認と有効化
-- ============================================

-- 1. Realtimeの有効化確認
-- Supabase Dashboardで Database > Publications を確認
-- デフォルトで "supabase_realtime" publicationが存在し、以下のテーブルが含まれている必要があります

-- 確認用クエリ（読み取り専用）
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('training_scores', 'results', 'sessions');

-- もしテーブルが含まれていない場合、以下を実行
-- ALTER PUBLICATION supabase_realtime ADD TABLE training_scores;
-- ALTER PUBLICATION supabase_realtime ADD TABLE results;
-- ALTER PUBLICATION supabase_realtime ADD TABLE sessions;


-- ============================================
-- 2. replica_identityの設定
-- ============================================

-- 現在の設定を確認
SELECT
  schemaname,
  tablename,
  CASE relreplident
    WHEN 'd' THEN 'DEFAULT (primary key)'
    WHEN 'n' THEN 'NOTHING'
    WHEN 'f' THEN 'FULL'
    WHEN 'i' THEN 'INDEX'
  END as replica_identity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_publication_tables pt ON pt.tablename = c.relname
WHERE n.nspname = 'public'
  AND c.relname IN ('training_scores', 'results', 'sessions')
ORDER BY c.relname;

-- FULLに設定（DELETE時にold値を取得できるようにする）
-- 注意: これによりWALログのサイズが増加する可能性があります
ALTER TABLE training_scores REPLICA IDENTITY FULL;
ALTER TABLE results REPLICA IDENTITY FULL;
ALTER TABLE sessions REPLICA IDENTITY FULL;

-- または、主キーのみで十分な場合（デフォルト）
-- ALTER TABLE training_scores REPLICA IDENTITY DEFAULT;
-- ALTER TABLE results REPLICA IDENTITY DEFAULT;
-- ALTER TABLE sessions REPLICA IDENTITY DEFAULT;


-- ============================================
-- 3. RLSポリシーの確認
-- ============================================

-- 現在のRLSポリシーを確認
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('training_scores', 'results', 'sessions')
ORDER BY tablename, policyname;

-- Realtimeは自動的にRLSポリシーを適用します
-- 既存のSELECTポリシーがそのまま適用されます
-- 追加の設定は不要ですが、以下を確認してください：

-- ✅ training_scores: セッション参加者のみ閲覧可能（migration 042で実装済み）
-- ✅ results: セッション参加者のみ閲覧可能
-- ✅ sessions: セッション参加者のみ閲覧可能
-- ✅ ゲストユーザーも guest_identifier でアクセス可能


-- ============================================
-- 4. Realtime設定の最終確認
-- ============================================

-- テーブルがpublicationに含まれていることを確認
DO $$
DECLARE
  table_name TEXT;
  is_published BOOLEAN;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['training_scores', 'results', 'sessions']
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND tablename = table_name
    ) INTO is_published;

    IF is_published THEN
      RAISE NOTICE '✅ % is published for Realtime', table_name;
    ELSE
      RAISE WARNING '❌ % is NOT published for Realtime - please add it manually', table_name;
    END IF;
  END LOOP;
END $$;
