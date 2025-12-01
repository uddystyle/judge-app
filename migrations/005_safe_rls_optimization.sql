-- ============================================================
-- Safe RLS Optimization Using SECURITY DEFINER Functions
-- ============================================================
-- This approach optimizes RLS policies while avoiding:
-- 1. Infinite recursion
-- 2. RLS Initplan performance issues
-- 3. Breaking existing functionality
-- ============================================================

-- ============================================================
-- STEP 1: Create Helper Functions (SECURITY DEFINER)
-- ============================================================
-- These functions bypass RLS and cache auth.uid() evaluation

-- Get current user ID (cached, bypasses RLS)
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID AS $$
BEGIN
  RETURN auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_current_user_id() IS
'Returns current authenticated user ID. SECURITY DEFINER bypasses RLS. STABLE ensures result is cached within transaction.';

-- Check if user is session creator
CREATE OR REPLACE FUNCTION is_session_creator(session_id_param BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM sessions
    WHERE id = session_id_param
    AND created_by = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if user is session participant
CREATE OR REPLACE FUNCTION is_session_participant(session_id_param BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM session_participants
    WHERE session_id = session_id_param
    AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Get user's organization IDs (already created in 004)
-- Recreate to ensure it exists and is optimized
CREATE OR REPLACE FUNCTION get_user_organization_ids()
RETURNS SETOF UUID AS $$
BEGIN
  RETURN QUERY
  SELECT organization_id
  FROM organization_members
  WHERE user_id = auth.uid()
    AND removed_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if user is organization admin (already created in 004)
-- Recreate to ensure it exists and is optimized
CREATE OR REPLACE FUNCTION is_organization_admin(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role = 'admin'
      AND removed_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- STEP 2: Grant Execute Permissions
-- ============================================================

GRANT EXECUTE ON FUNCTION get_current_user_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION is_session_creator(BIGINT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION is_session_participant(BIGINT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_user_organization_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION is_organization_admin(UUID) TO authenticated;

-- ============================================================
-- STEP 3: Optimize PROFILES Table (Low Risk)
-- ============================================================

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (id = get_current_user_id());

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
TO authenticated
USING (id = get_current_user_id());

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (id = get_current_user_id());

-- ============================================================
-- STEP 4: Optimize SESSIONS Table (Medium Risk)
-- ============================================================

DROP POLICY IF EXISTS "Users can view own sessions" ON sessions;
CREATE POLICY "Users can view own sessions"
ON sessions FOR SELECT
TO authenticated
USING (created_by = get_current_user_id());

DROP POLICY IF EXISTS "Users can create sessions" ON sessions;
CREATE POLICY "Users can create sessions"
ON sessions FOR INSERT
TO authenticated
WITH CHECK (created_by = get_current_user_id());

DROP POLICY IF EXISTS "Users can update own sessions" ON sessions;
CREATE POLICY "Users can update own sessions"
ON sessions FOR UPDATE
TO authenticated
USING (created_by = get_current_user_id());

DROP POLICY IF EXISTS "Users can delete own sessions" ON sessions;
CREATE POLICY "Users can delete own sessions"
ON sessions FOR DELETE
TO authenticated
USING (created_by = get_current_user_id());

DROP POLICY IF EXISTS "Chief judges can view sessions" ON sessions;
CREATE POLICY "Chief judges can view sessions"
ON sessions FOR SELECT
TO authenticated
USING (chief_judge_id = get_current_user_id());

-- Organization sessions policy remains the same (uses helper function)
DROP POLICY IF EXISTS "Organization members can view organization sessions" ON sessions;
CREATE POLICY "Organization members can view organization sessions"
ON sessions FOR SELECT
TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id IN (SELECT get_user_organization_ids())
);

-- ============================================================
-- STEP 5: Optimize SESSION_PARTICIPANTS Table (Medium Risk)
-- ============================================================

DROP POLICY IF EXISTS "Users can view their own participations" ON session_participants;
CREATE POLICY "Users can view their own participations"
ON session_participants FOR SELECT
TO authenticated
USING (user_id = get_current_user_id());

-- ============================================================
-- STEP 6: Optimize CUSTOM_EVENTS Table (Medium Risk)
-- ============================================================

DROP POLICY IF EXISTS "Session participants can view custom events" ON custom_events;
CREATE POLICY "Session participants can view custom events"
ON custom_events FOR SELECT
TO authenticated
USING (is_session_participant(session_id));

DROP POLICY IF EXISTS "Session creators can insert custom events" ON custom_events;
CREATE POLICY "Session creators can insert custom events"
ON custom_events FOR INSERT
TO authenticated
WITH CHECK (is_session_creator(session_id));

DROP POLICY IF EXISTS "Session creators can update custom events" ON custom_events;
CREATE POLICY "Session creators can update custom events"
ON custom_events FOR UPDATE
TO authenticated
USING (is_session_creator(session_id));

DROP POLICY IF EXISTS "Session creators can delete custom events" ON custom_events;
CREATE POLICY "Session creators can delete custom events"
ON custom_events FOR DELETE
TO authenticated
USING (is_session_creator(session_id));

-- ============================================================
-- STEP 7: Optimize PARTICIPANTS Table (Medium Risk)
-- ============================================================

DROP POLICY IF EXISTS "Session participants can view participants" ON participants;
CREATE POLICY "Session participants can view participants"
ON participants FOR SELECT
TO authenticated
USING (is_session_participant(session_id));

DROP POLICY IF EXISTS "Session creators can insert participants" ON participants;
CREATE POLICY "Session creators can insert participants"
ON participants FOR INSERT
TO authenticated
WITH CHECK (is_session_creator(session_id));

DROP POLICY IF EXISTS "Session creators can update participants" ON participants;
CREATE POLICY "Session creators can update participants"
ON participants FOR UPDATE
TO authenticated
USING (is_session_creator(session_id));

DROP POLICY IF EXISTS "Session creators can delete participants" ON participants;
CREATE POLICY "Session creators can delete participants"
ON participants FOR DELETE
TO authenticated
USING (is_session_creator(session_id));

-- ============================================================
-- STEP 8: Optimize TRAINING_EVENTS Table (Medium Risk)
-- ============================================================

DROP POLICY IF EXISTS "Session participants can view training events" ON training_events;
CREATE POLICY "Session participants can view training events"
ON training_events FOR SELECT
TO authenticated
USING (is_session_participant(session_id));

DROP POLICY IF EXISTS "Session creators can insert training events" ON training_events;
CREATE POLICY "Session creators can insert training events"
ON training_events FOR INSERT
TO authenticated
WITH CHECK (is_session_creator(session_id));

DROP POLICY IF EXISTS "Session creators can update training events" ON training_events;
CREATE POLICY "Session creators can update training events"
ON training_events FOR UPDATE
TO authenticated
USING (is_session_creator(session_id));

DROP POLICY IF EXISTS "Session creators can delete training events" ON training_events;
CREATE POLICY "Session creators can delete training events"
ON training_events FOR DELETE
TO authenticated
USING (is_session_creator(session_id));

-- ============================================================
-- STEP 9: Optimize TRAINING_SESSIONS Table (Medium Risk)
-- ============================================================

DROP POLICY IF EXISTS "Session participants can view training sessions" ON training_sessions;
CREATE POLICY "Session participants can view training sessions"
ON training_sessions FOR SELECT
TO authenticated
USING (is_session_participant(session_id));

DROP POLICY IF EXISTS "Session creators can manage training sessions" ON training_sessions;
CREATE POLICY "Session creators can manage training sessions"
ON training_sessions FOR ALL
TO authenticated
USING (is_session_creator(session_id));

-- ============================================================
-- STEP 10: Optimize TRAINING_SCORES Table (Medium Risk)
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can update their own training scores" ON training_scores;
CREATE POLICY "Authenticated users can update their own training scores"
ON training_scores FOR UPDATE
TO authenticated
USING (judge_id = get_current_user_id())
WITH CHECK (judge_id = get_current_user_id());

-- Note: Other training_scores policies use complex joins and should remain as-is
-- or require specialized helper functions

-- ============================================================
-- STEP 11: Optimize ORGANIZATIONS Table (Low Risk)
-- ============================================================

-- Already optimized in Step 1 with helper functions
-- No changes needed - current policies use get_user_organization_ids()

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Check that all functions exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_current_user_id') THEN
    RAISE EXCEPTION 'Function get_current_user_id not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_session_creator') THEN
    RAISE EXCEPTION 'Function is_session_creator not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_session_participant') THEN
    RAISE EXCEPTION 'Function is_session_participant not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_user_organization_ids') THEN
    RAISE EXCEPTION 'Function get_user_organization_ids not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_organization_admin') THEN
    RAISE EXCEPTION 'Function is_organization_admin not found';
  END IF;

  RAISE NOTICE '✓ All helper functions created successfully';
END $$;

-- Check that policies were created
SELECT
  schemaname,
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE tablename IN ('profiles', 'sessions', 'custom_events', 'participants', 'training_events', 'training_sessions')
ORDER BY tablename, policyname;

-- ============================================================
-- PERFORMANCE NOTES
-- ============================================================
--
-- Expected improvements:
-- 1. auth.uid() evaluated once per transaction (STABLE function)
-- 2. Complex checks (is_session_participant, etc.) cached
-- 3. No infinite recursion (SECURITY DEFINER bypasses RLS)
-- 4. Query planner can optimize better with function calls
--
-- Test performance with:
-- EXPLAIN ANALYZE SELECT * FROM sessions WHERE created_by = auth.uid();
-- EXPLAIN ANALYZE SELECT * FROM sessions WHERE created_by = get_current_user_id();
--
-- ============================================================
