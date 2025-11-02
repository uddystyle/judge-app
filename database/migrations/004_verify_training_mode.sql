-- ============================================================
-- Verification Script for Training Mode Migration
-- ============================================================

-- 1. Check if mode column exists in sessions table
SELECT
  'sessions table mode column' as check_type,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'sessions'
  AND column_name = 'mode'
ORDER BY column_name;

-- 2. Check if new tables exist
SELECT
  'new tables' as check_type,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_name IN ('training_sessions', 'training_events', 'training_scores')
  AND table_schema = 'public';

-- 3. Check training_sessions table structure
SELECT
  'training_sessions columns' as check_type,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'training_sessions'
ORDER BY ordinal_position;

-- 4. Check training_events table structure
SELECT
  'training_events columns' as check_type,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'training_events'
ORDER BY ordinal_position;

-- 5. Check training_scores table structure
SELECT
  'training_scores columns' as check_type,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'training_scores'
ORDER BY ordinal_position;

-- 6. Check RLS policies for training_sessions
SELECT
  'training_sessions policies' as check_type,
  policyname,
  cmd,
  CASE
    WHEN length(qual::text) > 100 THEN substring(qual::text, 1, 100) || '...'
    ELSE qual::text
  END as qual_preview
FROM pg_policies
WHERE tablename = 'training_sessions'
ORDER BY policyname;

-- 7. Check RLS policies for training_events
SELECT
  'training_events policies' as check_type,
  policyname,
  cmd,
  CASE
    WHEN length(qual::text) > 100 THEN substring(qual::text, 1, 100) || '...'
    ELSE qual::text
  END as qual_preview
FROM pg_policies
WHERE tablename = 'training_events'
ORDER BY policyname;

-- 8. Check RLS policies for training_scores
SELECT
  'training_scores policies' as check_type,
  policyname,
  cmd,
  CASE
    WHEN length(qual::text) > 100 THEN substring(qual::text, 1, 100) || '...'
    ELSE qual::text
  END as qual_preview
FROM pg_policies
WHERE tablename = 'training_scores'
ORDER BY policyname;

-- 9. Check indexes
SELECT
  'indexes' as check_type,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN ('training_sessions', 'training_events', 'training_scores', 'sessions')
  AND schemaname = 'public'
  AND (indexname LIKE '%training%' OR indexname LIKE '%sessions_mode%')
ORDER BY tablename, indexname;

-- 10. Check triggers
SELECT
  'triggers' as check_type,
  event_object_table as table_name,
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE event_object_table IN ('training_sessions', 'training_events', 'training_scores')
ORDER BY event_object_table, trigger_name;

-- 11. Check constraints
SELECT
  'constraints' as check_type,
  table_name,
  constraint_name,
  constraint_type
FROM information_schema.table_constraints
WHERE table_name IN ('sessions', 'training_sessions', 'training_events', 'training_scores')
  AND constraint_type IN ('CHECK', 'UNIQUE', 'FOREIGN KEY')
  AND (constraint_name LIKE '%training%' OR constraint_name LIKE '%mode%')
ORDER BY table_name, constraint_name;

-- 12. Check foreign key relationships
SELECT
  'foreign keys' as check_type,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('training_sessions', 'training_events', 'training_scores')
ORDER BY tc.table_name, kcu.column_name;

-- 13. Check RLS is enabled
SELECT
  'RLS enabled' as check_type,
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename IN ('training_sessions', 'training_events', 'training_scores')
  AND schemaname = 'public';

-- 14. Check table comments
SELECT
  'table comments' as check_type,
  c.relname as table_name,
  pg_catalog.obj_description(c.oid, 'pg_class') as table_comment
FROM pg_catalog.pg_class c
WHERE c.relname IN ('training_sessions', 'training_events', 'training_scores')
  AND c.relkind = 'r'
  AND pg_catalog.obj_description(c.oid, 'pg_class') IS NOT NULL
ORDER BY c.relname;

-- 15. Summary
SELECT
  'summary' as check_type,
  'sessions mode column' as item,
  COUNT(*) as count
FROM information_schema.columns
WHERE table_name = 'sessions'
  AND column_name = 'mode'

UNION ALL

SELECT
  'summary' as check_type,
  'new tables created' as item,
  COUNT(*) as count
FROM information_schema.tables
WHERE table_name IN ('training_sessions', 'training_events', 'training_scores')
  AND table_schema = 'public'

UNION ALL

SELECT
  'summary' as check_type,
  'training_sessions policies' as item,
  COUNT(*) as count
FROM pg_policies
WHERE tablename = 'training_sessions'

UNION ALL

SELECT
  'summary' as check_type,
  'training_events policies' as item,
  COUNT(*) as count
FROM pg_policies
WHERE tablename = 'training_events'

UNION ALL

SELECT
  'summary' as check_type,
  'training_scores policies' as item,
  COUNT(*) as count
FROM pg_policies
WHERE tablename = 'training_scores'

UNION ALL

SELECT
  'summary' as check_type,
  'total indexes created' as item,
  COUNT(*) as count
FROM pg_indexes
WHERE tablename IN ('training_sessions', 'training_events', 'training_scores', 'sessions')
  AND schemaname = 'public'
  AND (indexname LIKE '%training%' OR indexname LIKE '%sessions_mode%')

UNION ALL

SELECT
  'summary' as check_type,
  'total triggers created' as item,
  COUNT(*) as count
FROM information_schema.triggers
WHERE event_object_table IN ('training_sessions', 'training_events', 'training_scores');
