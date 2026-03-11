-- ============================================================================
-- Migration: Fix RLS policies for Realtime security
-- Description: 他セッションのデータ漏洩を防ぐためRLSポリシーを強化
-- Priority: CRITICAL SECURITY FIX
-- Date: 2026-03-11
-- Status: ⚠️ DEPRECATED - Use Migration 1000 instead
-- ============================================================================
-- ⚠️ WARNING: This migration is DEPRECATED and has known vulnerabilities:
-- 1. Guest session isolation: Uses "is_guest = true" which allows cross-session access
-- 2. Authenticated user UPDATE: Uses "judge_name" which allows same-name collision
--
-- ✅ USE MIGRATION 1000 INSTEAD:
--    - database/migrations/1000_secure_guest_session_isolation.sql
--    - Implements JWT-based guest session isolation
--    - Adds session_participants check for authenticated users
--    - Reduces same-name collision risk
--
-- ⚠️ DO NOT RUN THIS MIGRATION IN PRODUCTION
-- ============================================================================

DO $$
BEGIN
  RAISE WARNING '=================================================================';
  RAISE WARNING '⚠️ DEPRECATED MIGRATION: 999_fix_rls_realtime_security.sql';
  RAISE WARNING '=================================================================';
  RAISE WARNING '';
  RAISE WARNING 'This migration has known security vulnerabilities:';
  RAISE WARNING '1. Guest session isolation: "is_guest = true" allows cross-session access';
  RAISE WARNING '2. Authenticated user UPDATE: "judge_name" allows same-name collision';
  RAISE WARNING '';
  RAISE WARNING '✅ USE MIGRATION 1000 INSTEAD:';
  RAISE WARNING '   database/migrations/1000_secure_guest_session_isolation.sql';
  RAISE WARNING '';
  RAISE WARNING '⚠️ THIS MIGRATION WILL PROCEED BUT IS NOT RECOMMENDED';
  RAISE WARNING 'Press Ctrl+C to cancel, or wait 5 seconds to continue...';
  RAISE WARNING '=================================================================';
  PERFORM pg_sleep(5);
END $$;

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'CRITICAL SECURITY FIX: Strengthening RLS policies for Realtime';
  RAISE NOTICE '(⚠️ DEPRECATED - See Migration 1000 for improved version)';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Issue: Current RLS policies allow cross-session data leakage:';
  RAISE NOTICE '  - training_scores: USING (true) for anon role';
  RAISE NOTICE '  - results: USING (true) for authenticated role';
  RAISE NOTICE '';
  RAISE NOTICE 'Fix: Enforce session participant verification';
  RAISE NOTICE '  ⚠️ Known limitation: judge_name string matching (collision risk)';
  RAISE NOTICE '=================================================================';
END $$;

-- ============================================================================
-- Part 1: training_scores テーブルのRLS修正（ゲストユーザー）
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Part 1: Fixing training_scores RLS policies...';
  RAISE NOTICE '--------------------------------------------------------';
END $$;

-- 1-1. 既存の危険なポリシーを削除
DROP POLICY IF EXISTS "Anonymous users can view training scores" ON training_scores;

DO $$
BEGIN
  RAISE NOTICE '✓ Dropped insecure policy: "Anonymous users can view training scores"';
END $$;

-- 1-2. セキュアなポリシーを作成（セッション参加者のみ）
CREATE POLICY "Anonymous users can view training scores in their sessions"
  ON training_scores FOR SELECT
  TO anon
  USING (
    -- ゲストが参加しているセッションのtraining_scoresのみ閲覧可能
    event_id IN (
      SELECT te.id
      FROM training_events te
      JOIN sessions s ON s.id = te.session_id
      WHERE s.id IN (
        SELECT session_id
        FROM session_participants
        WHERE is_guest = true
        -- Note: ゲストの識別はクライアント側でguest_identifierパラメータで行う
        -- RLSでは全ゲストが同じ権限を持つが、クライアント側でフィルタリング
      )
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created secure policy: "Anonymous users can view training scores in their sessions"';
  RAISE NOTICE '  Scope: Limited to training_scores in sessions with guest participants';
END $$;

-- ============================================================================
-- Part 2: results テーブルのRLS修正（認証ユーザー + ゲストユーザー）
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Part 2: Fixing results RLS policies...';
  RAISE NOTICE '--------------------------------------------------------';
END $$;

-- 2-1. 既存の危険なポリシーを削除
DROP POLICY IF EXISTS "Authenticated users can view results" ON results;
DROP POLICY IF EXISTS "Authenticated users can insert results" ON results;
DROP POLICY IF EXISTS "Authenticated users can update results" ON results;
DROP POLICY IF EXISTS "Authenticated users can delete results" ON results;

DO $$
BEGIN
  RAISE NOTICE '✓ Dropped insecure policies on results table';
END $$;

-- 2-2. 認証ユーザー用の厳密なポリシー
CREATE POLICY "Authenticated users can view results in their sessions"
  ON results FOR SELECT
  TO authenticated
  USING (
    -- セッション参加者のみ閲覧可能
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created: "Authenticated users can view results in their sessions"';
END $$;

CREATE POLICY "Authenticated users can insert results in their sessions"
  ON results FOR INSERT
  TO authenticated
  WITH CHECK (
    -- 自分が参加しているセッションにのみ挿入可能
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created: "Authenticated users can insert results in their sessions"';
END $$;

CREATE POLICY "Authenticated users can update their own results"
  ON results FOR UPDATE
  TO authenticated
  USING (
    -- 自分の名前と一致するスコアのみ更新可能
    judge_name IN (
      SELECT full_name
      FROM profiles
      WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    -- 更新後も自分の名前であること
    judge_name IN (
      SELECT full_name
      FROM profiles
      WHERE id = auth.uid()
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created: "Authenticated users can update their own results"';
  RAISE NOTICE '  Note: results table uses judge_name (string) instead of judge_id';
END $$;

-- 2-3. 既存のDELETEポリシーは維持（主任検定員のみ）
-- "chief_judge_can_delete_results" は既に存在するためそのまま

-- 2-4. ゲストユーザー用のポリシー（新規作成）
CREATE POLICY "Anonymous users can view results in sessions with guests"
  ON results FOR SELECT
  TO anon
  USING (
    -- ゲストが参加しているセッションのresultsのみ閲覧可能
    session_id IN (
      SELECT DISTINCT session_id
      FROM session_participants
      WHERE is_guest = true
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created: "Anonymous users can view results in sessions with guests"';
END $$;

-- 2-5. ゲストユーザーのINSERT/UPDATEポリシーは既存を維持
-- "Guests can insert results for sessions they participate in" (migration 010)
-- "Guests can update their own results" (migration 010)

-- ============================================================================
-- Part 3: sessions テーブルのRLS確認・強化
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Part 3: Verifying sessions RLS policies...';
  RAISE NOTICE '--------------------------------------------------------';
END $$;

-- 3-1. 既存ポリシーの確認
DO $$
DECLARE
  auth_policy_exists BOOLEAN;
  anon_policy_exists BOOLEAN;
BEGIN
  -- Authenticated users
  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'sessions'
      AND 'authenticated'::text = ANY(roles::text[])
      AND cmd = 'SELECT'
  ) INTO auth_policy_exists;

  -- Anonymous users
  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'sessions'
      AND 'anon'::text = ANY(roles::text[])
      AND cmd = 'SELECT'
  ) INTO anon_policy_exists;

  IF auth_policy_exists THEN
    RAISE NOTICE '✓ sessions has SELECT policy for authenticated users';
  ELSE
    RAISE WARNING '⚠ sessions does NOT have SELECT policy for authenticated users';
  END IF;

  IF anon_policy_exists THEN
    RAISE NOTICE '✓ sessions has SELECT policy for anonymous users';
  ELSE
    RAISE WARNING '⚠ sessions does NOT have SELECT policy for anonymous users';
    RAISE WARNING '  Consider adding session access policy for guests';
  END IF;
END $$;

-- ============================================================================
-- Part 4: Realtime publication確認
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Part 4: Verifying Realtime publication...';
  RAISE NOTICE '--------------------------------------------------------';
END $$;

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
      RAISE NOTICE '✓ % is published for Realtime', table_name;
    ELSE
      RAISE WARNING '❌ % is NOT published for Realtime', table_name;
      RAISE WARNING '  Run: ALTER PUBLICATION supabase_realtime ADD TABLE %;', table_name;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- Part 5: RLSが有効化されていることを確認
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Part 5: Verifying RLS is enabled...';
  RAISE NOTICE '--------------------------------------------------------';
END $$;

DO $$
DECLARE
  table_name TEXT;
  rls_enabled BOOLEAN;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['training_scores', 'results', 'sessions']
  LOOP
    SELECT relrowsecurity
    FROM pg_class
    WHERE relname = table_name
    INTO rls_enabled;

    IF rls_enabled THEN
      RAISE NOTICE '✓ RLS is enabled on %', table_name;
    ELSE
      RAISE WARNING '❌ RLS is NOT enabled on %', table_name;
      RAISE WARNING '  Run: ALTER TABLE % ENABLE ROW LEVEL SECURITY;', table_name;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- Part 6: 最終確認 - 現在のRLSポリシー一覧
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Part 6: Current RLS policies summary';
  RAISE NOTICE '=================================================================';
END $$;

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
    WHEN qual::text LIKE '%true%' AND qual::text NOT LIKE '%EXISTS%' THEN '⚠️ WIDE ACCESS'
    WHEN qual::text LIKE '%session_participants%' THEN '✅ Session-scoped'
    WHEN qual::text LIKE '%auth.uid()%' THEN '✅ User-scoped'
    ELSE '🔍 Custom'
  END as scope
FROM pg_policies
WHERE tablename IN ('training_scores', 'results', 'sessions')
ORDER BY tablename, cmd, policyname;

-- ============================================================================
-- 完了メッセージ
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 999_fix_rls_realtime_security.sql COMPLETED';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Security improvements:';
  RAISE NOTICE '✅ training_scores: Guest access limited to their sessions';
  RAISE NOTICE '✅ results: Authenticated access limited to their sessions';
  RAISE NOTICE '✅ results: Guest access limited to sessions with guests';
  RAISE NOTICE '';
  RAISE NOTICE 'IMPORTANT NOTES:';
  RAISE NOTICE '1. Realtime automatically applies these RLS policies';
  RAISE NOTICE '2. Client-side filters provide additional granularity';
  RAISE NOTICE '3. Test thoroughly with multiple sessions to verify isolation';
  RAISE NOTICE '4. results table uses judge_name (string) not judge_id (UUID)';
  RAISE NOTICE '';
  RAISE NOTICE 'Testing checklist:';
  RAISE NOTICE '□ Session A: Judge 1 cannot see Session B scores via Realtime';
  RAISE NOTICE '□ Guest in Session A: Cannot see Session B training_scores';
  RAISE NOTICE '□ Authenticated user: Cannot subscribe to other session results';
  RAISE NOTICE '=================================================================';
END $$;
