-- Migration: Update RLS policies for training_scores to support guest users
-- Description: 研修モードのゲストユーザーがスコアを入力・閲覧できるようにRLSポリシーを更新
-- Date: 2025-11-13

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Updating RLS policies for training_scores (guest user support)';
  RAISE NOTICE '=================================================================';
END $$;

-- ====================================================================
-- Step 1: 既存ポリシーの削除
-- ====================================================================

DO $$
BEGIN
  RAISE NOTICE 'Step 1: Dropping existing RLS policies...';
END $$;

-- 本番環境のみ存在する既存ポリシーを削除
DROP POLICY IF EXISTS "Judges can view their own scores" ON training_scores;
DROP POLICY IF EXISTS "Judges can insert their own scores" ON training_scores;
DROP POLICY IF EXISTS "Judges can update their own scores" ON training_scores;

DO $$
BEGIN
  RAISE NOTICE '✓ Existing policies dropped (if they existed)';
END $$;

-- ====================================================================
-- Step 2: 認証ユーザー用ポリシー（authenticated role）
-- ====================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Step 2: Creating policies for authenticated users...';
  RAISE NOTICE '=================================================================';
END $$;

-- 2-1. SELECT: セッション参加者は全スコアを閲覧可能
DO $$
BEGIN
  RAISE NOTICE 'Step 2-1: Creating SELECT policy for authenticated users...';
END $$;

CREATE POLICY "Authenticated users can view training scores in their sessions"
  ON training_scores FOR SELECT
  TO authenticated
  USING (
    event_id IN (
      SELECT te.id
      FROM training_events te
      JOIN sessions s ON s.id = te.session_id
      WHERE s.id IN (
        SELECT session_id
        FROM session_participants
        WHERE user_id = auth.uid()
      )
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ SELECT policy created for authenticated users';
  RAISE NOTICE '  Scope: Users can view all training scores in sessions they participate in';
END $$;

-- 2-2. INSERT: 自分のスコアのみ挿入可能（セッション参加者であること）
DO $$
BEGIN
  RAISE NOTICE 'Step 2-2: Creating INSERT policy for authenticated users...';
END $$;

CREATE POLICY "Authenticated users can insert their own training scores"
  ON training_scores FOR INSERT
  TO authenticated
  WITH CHECK (
    judge_id = auth.uid()
    AND event_id IN (
      SELECT te.id
      FROM training_events te
      WHERE te.session_id IN (
        SELECT session_id
        FROM session_participants
        WHERE user_id = auth.uid()
      )
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ INSERT policy created for authenticated users';
  RAISE NOTICE '  Scope: Users can insert their own scores in sessions they participate in';
END $$;

-- 2-3. UPDATE: 自分のスコアのみ更新可能
DO $$
BEGIN
  RAISE NOTICE 'Step 2-3: Creating UPDATE policy for authenticated users...';
END $$;

CREATE POLICY "Authenticated users can update their own training scores"
  ON training_scores FOR UPDATE
  TO authenticated
  USING (judge_id = auth.uid())
  WITH CHECK (judge_id = auth.uid());

DO $$
BEGIN
  RAISE NOTICE '✓ UPDATE policy created for authenticated users';
  RAISE NOTICE '  Scope: Users can update only their own scores';
END $$;

-- ====================================================================
-- Step 3: ゲストユーザー用ポリシー（anon role）
-- ====================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Step 3: Creating policies for anonymous (guest) users...';
  RAISE NOTICE '=================================================================';
END $$;

-- 3-1. SELECT: ゲストも全スコアを閲覧可能
DO $$
BEGIN
  RAISE NOTICE 'Step 3-1: Creating SELECT policy for anonymous users...';
END $$;

CREATE POLICY "Anonymous users can view training scores"
  ON training_scores FOR SELECT
  TO anon
  USING (true);

DO $$
BEGIN
  RAISE NOTICE '✓ SELECT policy created for anonymous users';
  RAISE NOTICE '  Scope: Guest users can view all training scores';
  RAISE NOTICE '  Note: Access to training_events and sessions tables is controlled separately';
END $$;

-- 3-2. INSERT: ゲストは自分のguest_identifierでスコアを挿入可能
DO $$
BEGIN
  RAISE NOTICE 'Step 3-2: Creating INSERT policy for anonymous users...';
END $$;

CREATE POLICY "Anonymous users can insert training scores"
  ON training_scores FOR INSERT
  TO anon
  WITH CHECK (
    guest_identifier IS NOT NULL
    AND guest_identifier IN (
      SELECT guest_identifier
      FROM session_participants
      WHERE is_guest = true
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ INSERT policy created for anonymous users';
  RAISE NOTICE '  Scope: Guest users can insert scores with their guest_identifier';
  RAISE NOTICE '  Validation: guest_identifier must exist in session_participants';
END $$;

-- 3-3. UPDATE: ゲストは自分のスコアのみ更新可能
DO $$
BEGIN
  RAISE NOTICE 'Step 3-3: Creating UPDATE policy for anonymous users...';
END $$;

CREATE POLICY "Anonymous users can update their own training scores"
  ON training_scores FOR UPDATE
  TO anon
  USING (
    guest_identifier IS NOT NULL
    AND guest_identifier IN (
      SELECT guest_identifier
      FROM session_participants
      WHERE is_guest = true
    )
  )
  WITH CHECK (
    guest_identifier IS NOT NULL
    AND guest_identifier IN (
      SELECT guest_identifier
      FROM session_participants
      WHERE is_guest = true
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ UPDATE policy created for anonymous users';
  RAISE NOTICE '  Scope: Guest users can update only their own scores';
END $$;

-- ====================================================================
-- Step 4: 関連テーブルのRLSポリシー確認
-- ====================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Step 4: Verifying related tables have anonymous access...';
  RAISE NOTICE '=================================================================';
END $$;

-- training_events テーブルのポリシー確認
DO $$
DECLARE
  policy_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'training_events'
      AND 'anon'::text = ANY(roles::text[])
  ) INTO policy_exists;

  IF policy_exists THEN
    RAISE NOTICE '✓ training_events has anonymous access policy';
  ELSE
    RAISE WARNING '⚠ training_events does NOT have anonymous access policy';
    RAISE WARNING '  Guest users may not be able to access training event details';
    RAISE WARNING '  Consider adding: CREATE POLICY "Anonymous users can view training events" ON training_events FOR SELECT TO anon USING (true);';
  END IF;
END $$;

-- sessions テーブルのポリシー確認
DO $$
DECLARE
  policy_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'sessions'
      AND 'anon'::text = ANY(roles::text[])
  ) INTO policy_exists;

  IF policy_exists THEN
    RAISE NOTICE '✓ sessions has anonymous access policy';
  ELSE
    RAISE WARNING '⚠ sessions does NOT have anonymous access policy';
    RAISE WARNING '  Guest users may not be able to access session details';
    RAISE WARNING '  This should have been added in Migration 039';
  END IF;
END $$;

-- session_participants テーブルのポリシー確認
DO $$
DECLARE
  policy_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'session_participants'
      AND 'anon'::text = ANY(roles::text[])
  ) INTO policy_exists;

  IF policy_exists THEN
    RAISE NOTICE '✓ session_participants has anonymous access policy';
  ELSE
    RAISE WARNING '⚠ session_participants does NOT have anonymous access policy';
    RAISE WARNING '  Guest users may not be able to verify their participation';
    RAISE WARNING '  This should have been added in Migration 039';
  END IF;
END $$;

-- ====================================================================
-- Step 5: 確認クエリ
-- ====================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Verification: Current RLS policies on training_scores';
  RAISE NOTICE '=================================================================';
END $$;

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'training_scores'
ORDER BY cmd, policyname;

-- ====================================================================
-- 完了メッセージ
-- ====================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 042_update_training_scores_rls_for_guests.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Policies created:';
  RAISE NOTICE '';
  RAISE NOTICE 'Authenticated users (logged in):';
  RAISE NOTICE '- SELECT: View all scores in their sessions';
  RAISE NOTICE '- INSERT: Insert own scores in their sessions';
  RAISE NOTICE '- UPDATE: Update own scores';
  RAISE NOTICE '';
  RAISE NOTICE 'Anonymous users (guests):';
  RAISE NOTICE '- SELECT: View all training scores';
  RAISE NOTICE '- INSERT: Insert scores with valid guest_identifier';
  RAISE NOTICE '- UPDATE: Update own scores';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Verify training_events and sessions have anonymous access (Migration 039)';
  RAISE NOTICE '2. Update application code to handle guest_identifier in:';
  RAISE NOTICE '   - Input page (+page.server.ts: submitScore action)';
  RAISE NOTICE '   - Status page (+page.server.ts: load function, judge name resolution)';
  RAISE NOTICE '   - Revision request (+page.server.ts: requestRevision action)';
  RAISE NOTICE '3. Test guest user scoring workflow end-to-end';
  RAISE NOTICE '=================================================================';
END $$;
