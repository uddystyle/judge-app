-- ============================================================================
-- RLSセキュリティ検証スクリプト
-- ============================================================================
--
-- 使い方:
--   psql $DATABASE_URL -f scripts/verify-rls-security.sql
--
-- または Supabase SQL Editor で実行
--
-- ============================================================================

\echo ''
\echo '======================================================================='
\echo 'RLS Security Verification Script'
\echo '======================================================================='
\echo ''

-- ============================================================================
-- 1. RLSが有効化されているか確認
-- ============================================================================

\echo '1. Checking if RLS is enabled...'
\echo '-------------------------------------------------------------------'

SELECT
  schemaname,
  tablename,
  CASE
    WHEN rowsecurity THEN '✅ ENABLED'
    ELSE '❌ DISABLED'
  END as rls_status
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
WHERE schemaname = 'public'
  AND tablename IN ('training_scores', 'results', 'sessions')
ORDER BY tablename;

\echo ''

-- ============================================================================
-- 2. 危険なポリシー（USING (true)）の検出
-- ============================================================================

\echo '2. Detecting insecure policies (USING true)...'
\echo '-------------------------------------------------------------------'

SELECT
  tablename,
  policyname,
  roles::text as role,
  cmd as operation,
  '🚨 SECURITY RISK' as status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('training_scores', 'results', 'sessions')
  AND (
    -- USING句のチェック
    (qual::text LIKE '%true%'
     AND qual::text NOT LIKE '%EXISTS%'
     AND qual::text NOT LIKE '%session_participants%'
     AND qual::text NOT LIKE '%auth.uid()%'
     AND qual::text NOT LIKE '%user_metadata%')
    OR
    -- WITH CHECK句のチェック（INSERT/UPDATE）
    (with_check::text LIKE '%true%'
     AND with_check::text NOT LIKE '%EXISTS%'
     AND with_check::text NOT LIKE '%session_participants%'
     AND with_check::text NOT LIKE '%auth.uid()%'
     AND with_check::text NOT LIKE '%user_metadata%')
  )
ORDER BY tablename, cmd;

\echo ''
\echo 'If any rows appear above, you have insecure policies!'
\echo 'Run: database/migrations/1000_secure_guest_session_isolation.sql'
\echo ''

-- ============================================================================
-- 3. 現在のRLSポリシー一覧（詳細）
-- ============================================================================

\echo '3. Current RLS policies summary...'
\echo '-------------------------------------------------------------------'

SELECT
  tablename,
  policyname,
  CASE
    WHEN 'authenticated' = ANY(roles::text[]) THEN '🔐 authenticated'
    WHEN 'anon' = ANY(roles::text[]) THEN '👤 anon'
    ELSE roles::text
  END as role,
  cmd as operation,
  CASE
    WHEN qual::text LIKE '%session_participants%' OR with_check::text LIKE '%session_participants%' THEN '✅ Session-scoped'
    WHEN qual::text LIKE '%user_metadata%' OR with_check::text LIKE '%user_metadata%' THEN '✅ JWT-scoped'
    WHEN qual::text LIKE '%auth.uid()%' OR with_check::text LIKE '%auth.uid()%' THEN '✅ User-scoped'
    WHEN (qual::text LIKE '%true%' AND qual::text NOT LIKE '%EXISTS%') OR (with_check::text LIKE '%true%' AND with_check::text NOT LIKE '%EXISTS%') THEN '⚠️ WIDE ACCESS'
    ELSE '🔍 Custom'
  END as scope_type,
  LEFT(COALESCE(qual::text, '') || ' | ' || COALESCE(with_check::text, ''), 80) || '...' as policy_condition
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('training_scores', 'results', 'sessions')
ORDER BY tablename, cmd, policyname;

\echo ''

-- ============================================================================
-- 4. Realtime Publication確認
-- ============================================================================

\echo '4. Checking Realtime publication status...'
\echo '-------------------------------------------------------------------'

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
      RAISE WARNING '❌ % is NOT published for Realtime', table_name;
    END IF;
  END LOOP;
END $$;

\echo ''

-- ============================================================================
-- 5. Replica Identity確認
-- ============================================================================

\echo '5. Checking replica identity settings...'
\echo '-------------------------------------------------------------------'

SELECT
  c.relname as tablename,
  CASE c.relreplident
    WHEN 'd' THEN '⚠️ DEFAULT (primary key only)'
    WHEN 'n' THEN '❌ NOTHING'
    WHEN 'f' THEN '✅ FULL'
    WHEN 'i' THEN '⚠️ INDEX'
  END as replica_identity,
  CASE c.relreplident
    WHEN 'f' THEN 'DELETE events include old values'
    WHEN 'd' THEN 'DELETE events include PK only'
    WHEN 'n' THEN 'No replication data'
    ELSE 'Custom index replication'
  END as description
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('training_scores', 'results', 'sessions')
ORDER BY c.relname;

\echo ''

-- ============================================================================
-- 6. ポリシーカバレッジ確認
-- ============================================================================

\echo '6. Checking policy coverage (SELECT, INSERT, UPDATE)...'
\echo '-------------------------------------------------------------------'

WITH expected_policies AS (
  SELECT tablename, role, cmd
  FROM (VALUES
    ('training_scores', 'authenticated', 'SELECT'),
    ('training_scores', 'authenticated', 'INSERT'),
    ('training_scores', 'authenticated', 'UPDATE'),
    ('training_scores', 'anon', 'SELECT'),
    ('training_scores', 'anon', 'INSERT'),
    ('training_scores', 'anon', 'UPDATE'),
    ('results', 'authenticated', 'SELECT'),
    ('results', 'authenticated', 'INSERT'),
    ('results', 'authenticated', 'UPDATE'),
    ('results', 'anon', 'SELECT'),
    ('sessions', 'authenticated', 'SELECT'),
    ('sessions', 'anon', 'SELECT')
  ) AS t(tablename, role, cmd)
),
actual_policies AS (
  SELECT
    tablename,
    CASE
      WHEN 'authenticated' = ANY(roles::text[]) THEN 'authenticated'
      WHEN 'anon' = ANY(roles::text[]) THEN 'anon'
      ELSE 'other'
    END as role,
    cmd
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('training_scores', 'results', 'sessions')
)
SELECT
  e.tablename,
  e.role,
  e.cmd,
  CASE
    WHEN a.tablename IS NOT NULL THEN '✅ EXISTS'
    ELSE '❌ MISSING'
  END as status
FROM expected_policies e
LEFT JOIN actual_policies a
  ON e.tablename = a.tablename
  AND e.role = a.role
  AND e.cmd = a.cmd
ORDER BY
  CASE WHEN a.tablename IS NULL THEN 0 ELSE 1 END,
  e.tablename,
  e.role,
  e.cmd;

\echo ''

-- ============================================================================
-- 7. セキュリティスコア（簡易）
-- ============================================================================

\echo '7. Security score calculation...'
\echo '-------------------------------------------------------------------'

DO $$
DECLARE
  rls_enabled_count INT;
  secure_policy_count INT;
  insecure_policy_count INT;
  published_count INT;
  total_checks INT := 20;
  passed_checks INT := 0;
  score NUMERIC;
BEGIN
  -- RLS有効化チェック（3テーブル）
  SELECT COUNT(*)
  FROM pg_tables t
  JOIN pg_class c ON c.relname = t.tablename
  WHERE t.schemaname = 'public'
    AND t.tablename IN ('training_scores', 'results', 'sessions')
    AND c.relrowsecurity = true
  INTO rls_enabled_count;
  passed_checks := passed_checks + rls_enabled_count;

  -- セキュアポリシーのカウント（USING句とWITH CHECK句の両方をチェック）
  SELECT COUNT(*)
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('training_scores', 'results', 'sessions')
    AND (
      qual::text LIKE '%session_participants%'
      OR qual::text LIKE '%auth.uid()%'
      OR qual::text LIKE '%user_metadata%'
      OR with_check::text LIKE '%session_participants%'
      OR with_check::text LIKE '%auth.uid()%'
      OR with_check::text LIKE '%user_metadata%'
    )
  INTO secure_policy_count;
  passed_checks := passed_checks + LEAST(secure_policy_count, 10);

  -- 危険なポリシーのカウント（マイナス）USING句とWITH CHECK句の両方をチェック
  SELECT COUNT(*)
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('training_scores', 'results', 'sessions')
    AND (
      (qual::text LIKE '%true%'
       AND qual::text NOT LIKE '%EXISTS%'
       AND qual::text NOT LIKE '%session_participants%'
       AND qual::text NOT LIKE '%auth.uid()%'
       AND qual::text NOT LIKE '%user_metadata%')
      OR
      (with_check::text LIKE '%true%'
       AND with_check::text NOT LIKE '%EXISTS%'
       AND with_check::text NOT LIKE '%session_participants%'
       AND with_check::text NOT LIKE '%auth.uid()%'
       AND with_check::text NOT LIKE '%user_metadata%')
    )
  INTO insecure_policy_count;
  passed_checks := passed_checks - (insecure_policy_count * 3);

  -- Publication確認（3テーブル）
  SELECT COUNT(*)
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND tablename IN ('training_scores', 'results', 'sessions')
  INTO published_count;
  passed_checks := passed_checks + published_count;

  -- スコア計算
  score := (passed_checks::NUMERIC / total_checks::NUMERIC * 100);

  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Security Score: % / % (% %%)', passed_checks, total_checks, ROUND(score, 1);
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Breakdown:';
  RAISE NOTICE '  RLS Enabled: % / 3', rls_enabled_count;
  RAISE NOTICE '  Secure Policies: %', secure_policy_count;
  RAISE NOTICE '  Insecure Policies: % (- %)', insecure_policy_count, insecure_policy_count * 3;
  RAISE NOTICE '  Published Tables: % / 3', published_count;
  RAISE NOTICE '';

  IF score >= 90 THEN
    RAISE NOTICE '✅ Excellent: Your RLS security is well configured!';
  ELSIF score >= 70 THEN
    RAISE NOTICE '⚠️ Good: Minor improvements recommended';
  ELSIF score >= 50 THEN
    RAISE NOTICE '⚠️ Fair: Security improvements needed';
  ELSE
    RAISE NOTICE '❌ Poor: CRITICAL security fixes required!';
    RAISE NOTICE '  Run: database/migrations/1000_secure_guest_session_isolation.sql';
  END IF;
  RAISE NOTICE '=================================================================';
END $$;

\echo ''
\echo '======================================================================='
\echo 'Verification Complete'
\echo '======================================================================='
\echo ''
\echo 'Next steps:'
\echo '1. Fix any MISSING or INSECURE policies'
\echo '2. Run: database/migrations/1000_secure_guest_session_isolation.sql'
\echo '3. Test cross-session access with multiple users'
\echo '4. Review GUEST_SESSION_SECURITY.md for detailed guidance'
\echo ''
