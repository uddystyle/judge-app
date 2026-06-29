-- ============================================================
-- Verification Script for Tournament Mode Migration
-- ============================================================

-- 1. Check if new columns exist in sessions table
SELECT
  'sessions table columns' as check_type,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'sessions'
  AND column_name IN ('is_tournament_mode', 'score_calculation', 'exclude_extremes')
ORDER BY column_name;

-- 2. Check if new tables exist
SELECT
  'new tables' as check_type,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_name IN ('custom_events', 'participants')
  AND table_schema = 'public';

-- 3. Check custom_events table structure
SELECT
  'custom_events columns' as check_type,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'custom_events'
ORDER BY ordinal_position;

-- 4. Check participants table structure
SELECT
  'participants columns' as check_type,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'participants'
ORDER BY ordinal_position;

-- 5. Check RLS policies for custom_events
SELECT
  'custom_events policies' as check_type,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'custom_events'
ORDER BY policyname;

-- 6. Check RLS policies for participants
SELECT
  'participants policies' as check_type,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'participants'
ORDER BY policyname;

-- 7. Check indexes
SELECT
  'indexes' as check_type,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN ('custom_events', 'participants')
  AND schemaname = 'public'
ORDER BY tablename, indexname;

-- 8. Check triggers
SELECT
  'triggers' as check_type,
  event_object_table as table_name,
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE event_object_table IN ('custom_events', 'participants')
ORDER BY event_object_table, trigger_name;

-- 9. Check constraints
SELECT
  'constraints' as check_type,
  table_name,
  constraint_name,
  constraint_type
FROM information_schema.table_constraints
WHERE table_name IN ('sessions', 'custom_events', 'participants')
  AND constraint_type IN ('CHECK', 'UNIQUE', 'FOREIGN KEY')
ORDER BY table_name, constraint_name;

-- 10. Summary
SELECT
  'summary' as check_type,
  'sessions columns added' as item,
  COUNT(*) as count
FROM information_schema.columns
WHERE table_name = 'sessions'
  AND column_name IN ('is_tournament_mode', 'score_calculation', 'exclude_extremes')

UNION ALL

SELECT
  'summary' as check_type,
  'new tables created' as item,
  COUNT(*) as count
FROM information_schema.tables
WHERE table_name IN ('custom_events', 'participants')
  AND table_schema = 'public'

UNION ALL

SELECT
  'summary' as check_type,
  'custom_events policies' as item,
  COUNT(*) as count
FROM pg_policies
WHERE tablename = 'custom_events'

UNION ALL

SELECT
  'summary' as check_type,
  'participants policies' as item,
  COUNT(*) as count
FROM pg_policies
WHERE tablename = 'participants';
