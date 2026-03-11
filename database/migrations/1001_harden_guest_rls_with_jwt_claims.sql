-- ============================================================================
-- Migration: Harden guest RLS with JWT claims (follow-up for migration 1000)
-- Description: anonポリシーを全量再作成し、セッション越境と同一セッション内なりすましを防止
-- Date: 2026-03-11
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Applying 1001_harden_guest_rls_with_jwt_claims.sql';
  RAISE NOTICE 'Target: training_scores/results anon policies';
  RAISE NOTICE '=================================================================';
END $$;

-- ============================================================================
-- Part 1: training_scores anon policies
-- 1) 既存 anon ポリシーを全削除（OR評価の穴を確実に閉じる）
-- 2) JWT claim + session_participants 照合で再作成
-- ============================================================================

DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'training_scores'
      AND 'anon' = ANY(roles::text[])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON training_scores', p.policyname);
    RAISE NOTICE 'Dropped training_scores anon policy: %', p.policyname;
  END LOOP;
END $$;

CREATE POLICY "anon_training_scores_select_scoped_by_jwt"
  ON training_scores
  FOR SELECT
  TO anon
  USING (
    event_id IN (
      SELECT te.id
      FROM training_events te
      WHERE te.session_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'session_id', '')::bigint
    )
    AND EXISTS (
      SELECT 1
      FROM training_events te
      JOIN session_participants sp ON sp.session_id = te.session_id
      WHERE te.id = training_scores.event_id
        AND sp.is_guest = true
        AND sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
        AND sp.session_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'session_id', '')::bigint
    )
  );

CREATE POLICY "anon_training_scores_insert_scoped_by_jwt"
  ON training_scores
  FOR INSERT
  TO anon
  WITH CHECK (
    guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
    AND event_id IN (
      SELECT te.id
      FROM training_events te
      WHERE te.session_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'session_id', '')::bigint
    )
    AND EXISTS (
      SELECT 1
      FROM training_events te
      JOIN session_participants sp ON sp.session_id = te.session_id
      WHERE te.id = training_scores.event_id
        AND sp.is_guest = true
        AND sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
        AND sp.session_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'session_id', '')::bigint
    )
  );

CREATE POLICY "anon_training_scores_update_scoped_by_jwt"
  ON training_scores
  FOR UPDATE
  TO anon
  USING (
    guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
    AND EXISTS (
      SELECT 1
      FROM training_events te
      JOIN session_participants sp ON sp.session_id = te.session_id
      WHERE te.id = training_scores.event_id
        AND sp.is_guest = true
        AND sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
        AND sp.session_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'session_id', '')::bigint
    )
  )
  WITH CHECK (
    guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
    AND EXISTS (
      SELECT 1
      FROM training_events te
      JOIN session_participants sp ON sp.session_id = te.session_id
      WHERE te.id = training_scores.event_id
        AND sp.is_guest = true
        AND sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
        AND sp.session_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'session_id', '')::bigint
    )
  );

CREATE POLICY "anon_training_scores_delete_scoped_by_jwt"
  ON training_scores
  FOR DELETE
  TO anon
  USING (
    guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
    AND EXISTS (
      SELECT 1
      FROM training_events te
      JOIN session_participants sp ON sp.session_id = te.session_id
      WHERE te.id = training_scores.event_id
        AND sp.is_guest = true
        AND sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
        AND sp.session_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'session_id', '')::bigint
    )
  );

-- ============================================================================
-- Part 2: results anon policies
-- 1) 既存 anon ポリシーを全削除
-- 2) JWT claim + session_participants 照合で再作成
--    - INSERT/UPDATEは judge_name のなりすましを防ぐため guest_identifier と照合
-- ============================================================================

DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'results'
      AND 'anon' = ANY(roles::text[])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON results', p.policyname);
    RAISE NOTICE 'Dropped results anon policy: %', p.policyname;
  END LOOP;
END $$;

CREATE POLICY "anon_results_select_scoped_by_jwt"
  ON results
  FOR SELECT
  TO anon
  USING (
    session_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'session_id', '')::bigint
    AND EXISTS (
      SELECT 1
      FROM session_participants sp
      WHERE sp.session_id = results.session_id
        AND sp.is_guest = true
        AND sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
    )
  );

CREATE POLICY "anon_results_insert_scoped_by_jwt"
  ON results
  FOR INSERT
  TO anon
  WITH CHECK (
    session_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'session_id', '')::bigint
    AND EXISTS (
      SELECT 1
      FROM session_participants sp
      WHERE sp.session_id = results.session_id
        AND sp.is_guest = true
        AND sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
        AND sp.guest_name = results.judge_name
    )
  );

CREATE POLICY "anon_results_update_scoped_by_jwt"
  ON results
  FOR UPDATE
  TO anon
  USING (
    session_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'session_id', '')::bigint
    AND EXISTS (
      SELECT 1
      FROM session_participants sp
      WHERE sp.session_id = results.session_id
        AND sp.is_guest = true
        AND sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
        AND sp.guest_name = results.judge_name
    )
  )
  WITH CHECK (
    session_id = NULLIF(auth.jwt() -> 'user_metadata' ->> 'session_id', '')::bigint
    AND EXISTS (
      SELECT 1
      FROM session_participants sp
      WHERE sp.session_id = results.session_id
        AND sp.is_guest = true
        AND sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
        AND sp.guest_name = results.judge_name
    )
  );

-- ============================================================================
-- Part 3: Verification snapshot
-- ============================================================================

DO $$
DECLARE
  training_anon_count INT;
  results_anon_count INT;
BEGIN
  SELECT COUNT(*) INTO training_anon_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'training_scores'
    AND 'anon' = ANY(roles::text[]);

  SELECT COUNT(*) INTO results_anon_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'results'
    AND 'anon' = ANY(roles::text[]);

  RAISE NOTICE 'training_scores anon policies: %', training_anon_count;
  RAISE NOTICE 'results anon policies: %', results_anon_count;
END $$;

SELECT
  tablename,
  policyname,
  cmd,
  roles::text AS roles,
  LEFT(COALESCE(qual::text, ''), 120) AS using_preview,
  LEFT(COALESCE(with_check::text, ''), 120) AS with_check_preview
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('training_scores', 'results')
  AND 'anon' = ANY(roles::text[])
ORDER BY tablename, cmd, policyname;

