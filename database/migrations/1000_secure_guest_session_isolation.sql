-- ============================================================================
-- Migration: Secure Guest Session Isolation with JWT Custom Claims
-- Description: JWT user_metadata を使用してゲストのセッション隔離を実現
-- Priority: CRITICAL SECURITY FIX
-- Date: 2026-03-11
-- Replaces: Migration 999 の脆弱なポリシーを完全に置き換え
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'CRITICAL SECURITY FIX: Guest Session Isolation with JWT';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Problem: Migration 999 allows cross-session data leakage:';
  RAISE NOTICE '  - "WHERE is_guest = true" matches ALL guests across ALL sessions';
  RAISE NOTICE '  - Guest in Session A can view Session B, C, D... data';
  RAISE NOTICE '';
  RAISE NOTICE 'Solution: Use JWT custom claims (user_metadata) for isolation:';
  RAISE NOTICE '  - Each guest JWT contains session_id + guest_identifier';
  RAISE NOTICE '  - RLS policies extract session_id from JWT';
  RAISE NOTICE '  - Guests can ONLY access their own session';
  RAISE NOTICE '=================================================================';
END $$;

-- ============================================================================
-- Part 1: training_scores テーブルのRLS修正（ゲストセッション隔離）
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Part 1: Fixing training_scores RLS policies for guests...';
  RAISE NOTICE '--------------------------------------------------------';
END $$;

-- 1-1. 脆弱なポリシーを削除
DROP POLICY IF EXISTS "Anonymous users can view training scores in their sessions" ON training_scores;

DO $$
BEGIN
  RAISE NOTICE '✓ Dropped insecure policy: "Anonymous users can view training scores in their sessions"';
  RAISE NOTICE '  Reason: "is_guest = true" matches all guests, not just their session';
END $$;

-- 1-2. セキュアなSELECTポリシーを作成（JWTベース）
CREATE POLICY "Guests can view training scores in their own session"
  ON training_scores FOR SELECT
  TO anon
  USING (
    -- JWTのuser_metadataからsession_idを取得して照合
    event_id IN (
      SELECT te.id
      FROM training_events te
      WHERE te.session_id = (
        NULLIF(current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'session_id', '')::bigint
      )
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created secure policy: "Guests can view training scores in their own session"';
  RAISE NOTICE '  Scope: Limited to session_id from JWT user_metadata';
END $$;

-- 1-3. INSERTポリシー（ゲストは自分のセッション&自分のguest_identifierのみ挿入可能）
DROP POLICY IF EXISTS "Guests can insert training_scores in their session" ON training_scores;

CREATE POLICY "Guests can insert training_scores in their own session"
  ON training_scores FOR INSERT
  TO anon
  WITH CHECK (
    event_id IN (
      SELECT te.id
      FROM training_events te
      WHERE te.session_id = (
        NULLIF(current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'session_id', '')::bigint
      )
    )
    AND guest_identifier = (
      current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'guest_identifier'
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created: "Guests can insert training_scores in their own session"';
  RAISE NOTICE '  Scope: Own session + own guest_identifier only';
END $$;

-- 1-4. UPDATEポリシー（自分のguest_identifierのスコアのみ更新可能）
DROP POLICY IF EXISTS "Guests can update their own training_scores" ON training_scores;

CREATE POLICY "Guests can update their own training_scores"
  ON training_scores FOR UPDATE
  TO anon
  USING (
    guest_identifier = (
      current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'guest_identifier'
    )
  )
  WITH CHECK (
    guest_identifier = (
      current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'guest_identifier'
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created: "Guests can update their own training_scores"';
  RAISE NOTICE '  Scope: Own guest_identifier only';
END $$;

-- 1-5. DELETEポリシー（自分のguest_identifierのスコアのみ削除可能）
DROP POLICY IF EXISTS "Guests can delete their own training_scores" ON training_scores;

CREATE POLICY "Guests can delete their own training_scores"
  ON training_scores FOR DELETE
  TO anon
  USING (
    guest_identifier = (
      current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'guest_identifier'
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created: "Guests can delete their own training_scores"';
  RAISE NOTICE '  Scope: Own guest_identifier only';
END $$;

-- ============================================================================
-- Part 2: results テーブルのRLS修正（ゲストセッション隔離）
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Part 2: Fixing results RLS policies for guests...';
  RAISE NOTICE '--------------------------------------------------------';
END $$;

-- 2-1. 脆弱なポリシーを削除
DROP POLICY IF EXISTS "Anonymous users can view results in sessions with guests" ON results;

DO $$
BEGIN
  RAISE NOTICE '✓ Dropped insecure policy: "Anonymous users can view results in sessions with guests"';
  RAISE NOTICE '  Reason: "is_guest = true" matches all guests, not just their session';
END $$;

-- 2-2. セキュアなSELECTポリシーを作成（JWTベース）
CREATE POLICY "Guests can view results in their own session"
  ON results FOR SELECT
  TO anon
  USING (
    session_id = (
      NULLIF(current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'session_id', '')::bigint
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created secure policy: "Guests can view results in their own session"';
  RAISE NOTICE '  Scope: Limited to session_id from JWT user_metadata';
END $$;

-- 2-3. INSERTポリシー（ゲストは自分のセッションにのみ挿入可能）
DROP POLICY IF EXISTS "Guests can insert results in their session" ON results;

CREATE POLICY "Guests can insert results in their own session"
  ON results FOR INSERT
  TO anon
  WITH CHECK (
    session_id = (
      NULLIF(current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'session_id', '')::bigint
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created: "Guests can insert results in their own session"';
  RAISE NOTICE '  Scope: Own session only';
END $$;

-- 2-4. UPDATEポリシー（ゲストは自分の名前のスコアのみ更新可能）
DROP POLICY IF EXISTS "Guests can update their own results" ON results;

CREATE POLICY "Guests can update their own results"
  ON results FOR UPDATE
  TO anon
  USING (
    judge_name = (
      current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'guest_name'
    )
    AND session_id = (
      NULLIF(current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'session_id', '')::bigint
    )
  )
  WITH CHECK (
    judge_name = (
      current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'guest_name'
    )
    AND session_id = (
      NULLIF(current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'session_id', '')::bigint
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created: "Guests can update their own results"';
  RAISE NOTICE '  Scope: Own guest_name + own session only';
END $$;

-- 2-5. 認証ユーザーのUPDATEポリシー修正（judge_name のみ依存を修正）
-- Migration 999 の脆弱なポリシーを置き換え
DROP POLICY IF EXISTS "Authenticated users can update their own results" ON results;

CREATE POLICY "Authenticated users can update their own results"
  ON results FOR UPDATE
  TO authenticated
  USING (
    -- ✅ SECURITY FIX: session_participants でセッション参加確認 + judge_name 一致
    -- これにより以下を防止:
    -- 1. クロスセッション攻撃（他セッションのスコア更新）
    -- 2. 同名ユーザー衝突リスクを大幅に削減（同一セッション内のみに限定）
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
    AND judge_name IN (
      SELECT full_name
      FROM profiles
      WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    -- 更新後も同じ条件を満たすこと
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
    AND judge_name IN (
      SELECT full_name
      FROM profiles
      WHERE id = auth.uid()
    )
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Fixed: "Authenticated users can update their own results"';
  RAISE NOTICE '  Security improvement: Added session_participants check';
  RAISE NOTICE '  - Prevents cross-session score updates';
  RAISE NOTICE '  - Reduces same-name collision risk to same-session only';
  RAISE NOTICE '  - Recommendation: Add judge_id (UUID) column for complete fix';
END $$;

-- ============================================================================
-- Part 3: 検証 - RLSポリシーが正しく適用されているか確認
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Part 3: Verifying new RLS policies...';
  RAISE NOTICE '--------------------------------------------------------';
END $$;

DO $$
DECLARE
  training_scores_policies INT;
  results_policies INT;
  dangerous_policies INT;
BEGIN
  -- training_scores のゲストポリシー数
  SELECT COUNT(*) INTO training_scores_policies
  FROM pg_policies
  WHERE tablename = 'training_scores'
    AND policyname LIKE '%own session%'
    AND 'anon' = ANY(roles::text[])
    AND qual::text LIKE '%user_metadata%';

  -- results のゲストポリシー数
  SELECT COUNT(*) INTO results_policies
  FROM pg_policies
  WHERE tablename = 'results'
    AND policyname LIKE '%own session%'
    AND 'anon' = ANY(roles::text[])
    AND qual::text LIKE '%user_metadata%';

  -- 危険なポリシー（is_guest = true のみで user_metadata なし）
  SELECT COUNT(*) INTO dangerous_policies
  FROM pg_policies
  WHERE tablename IN ('training_scores', 'results')
    AND 'anon' = ANY(roles::text[])
    AND qual::text LIKE '%is_guest%'
    AND qual::text NOT LIKE '%user_metadata%';

  IF training_scores_policies >= 4 THEN
    RAISE NOTICE '✅ training_scores has % secure guest policies (SELECT/INSERT/UPDATE/DELETE)', training_scores_policies;
  ELSE
    RAISE WARNING '⚠ training_scores only has % guest policies, expected 4', training_scores_policies;
  END IF;

  IF results_policies >= 3 THEN
    RAISE NOTICE '✅ results has % secure guest policies (SELECT/INSERT/UPDATE)', results_policies;
  ELSE
    RAISE WARNING '⚠ results only has % guest policies, expected 3', results_policies;
  END IF;

  IF dangerous_policies = 0 THEN
    RAISE NOTICE '✅ No dangerous policies detected (is_guest without user_metadata)';
  ELSE
    RAISE WARNING '❌ Found % dangerous policies with is_guest but no user_metadata check!', dangerous_policies;
  END IF;
END $$;

-- ============================================================================
-- Part 4: 現在のRLSポリシー一覧
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Part 4: Current RLS policies for training_scores and results';
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
    WHEN qual::text LIKE '%user_metadata%' THEN '✅ JWT-based (secure)'
    WHEN qual::text LIKE '%auth.uid()%' THEN '✅ User-scoped'
    WHEN qual::text LIKE '%is_guest%' THEN '⚠️ Guest-flag only (insecure)'
    ELSE '🔍 Other'
  END as security_level
FROM pg_policies
WHERE tablename IN ('training_scores', 'results')
  AND 'anon' = ANY(roles::text[])
ORDER BY tablename, cmd, policyname;

-- ============================================================================
-- 完了メッセージ
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 1000_secure_guest_session_isolation.sql COMPLETED';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Security improvements:';
  RAISE NOTICE '✅ training_scores: Guests can ONLY access their own session (JWT)';
  RAISE NOTICE '✅ results: Guests can ONLY access their own session (JWT)';
  RAISE NOTICE '✅ INSERT/UPDATE/DELETE: Guests can ONLY modify their own data';
  RAISE NOTICE '✅ Authenticated users: Added session_participants check for UPDATE';
  RAISE NOTICE '   - Prevents cross-session score updates';
  RAISE NOTICE '   - Reduces same-name collision risk';
  RAISE NOTICE '';
  RAISE NOTICE 'How it works:';
  RAISE NOTICE '1. Guest joins session → JWT issued with user_metadata:';
  RAISE NOTICE '   { session_id, guest_identifier, guest_name, is_guest: true }';
  RAISE NOTICE '2. Supabase injects JWT into PostgreSQL request.jwt.claims';
  RAISE NOTICE '3. RLS policies extract session_id from JWT';
  RAISE NOTICE '4. Cross-session access is BLOCKED at database level';
  RAISE NOTICE '';
  RAISE NOTICE 'IMPORTANT:';
  RAISE NOTICE '- Server-side must issue JWT via supabase.auth.signInAnonymously()';
  RAISE NOTICE '- Client-side must include JWT in all Supabase requests (automatic)';
  RAISE NOTICE '- Realtime subscriptions automatically enforce these RLS policies';
  RAISE NOTICE '';
  RAISE NOTICE 'Testing checklist:';
  RAISE NOTICE '□ Guest in Session A: CANNOT view Session B training_scores';
  RAISE NOTICE '□ Guest in Session A: CANNOT insert training_scores in Session B';
  RAISE NOTICE '□ Guest in Session A: CANNOT view Session B results';
  RAISE NOTICE '□ Guest with identifier X: CANNOT update scores for identifier Y';
  RAISE NOTICE '□ Authenticated user in Session A: CANNOT update Session B results';
  RAISE NOTICE '□ Same-name users in different sessions: CANNOT update each other';
  RAISE NOTICE '□ Run scripts/verify-guest-session-isolation.sql to verify';
  RAISE NOTICE '=================================================================';
END $$;
