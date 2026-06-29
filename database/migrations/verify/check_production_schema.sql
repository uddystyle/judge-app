-- 本番環境のスキーマ確認用SQL
-- このSQLを本番環境のSupabase SQL Editorで実行してください

-- ============================================================
-- 1. sessions テーブルの構造を確認
-- ============================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'sessions'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- ============================================================
-- 2. custom_events テーブルの構造を確認
-- ============================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'custom_events'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- ============================================================
-- 3. participants テーブルの構造を確認
-- ============================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'participants'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- ============================================================
-- 4. session_participants テーブルの構造を確認
-- ============================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'session_participants'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- ============================================================
-- 5. results テーブルの構造を確認
-- ============================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'results'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- ============================================================
-- 6. scoring_prompts テーブルの構造を確認
-- ============================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'scoring_prompts'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- ============================================================
-- 7. 外部キー制約を確認
-- ============================================================
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('sessions', 'custom_events', 'participants', 'session_participants', 'results', 'scoring_prompts')
ORDER BY tc.table_name, kcu.column_name;
