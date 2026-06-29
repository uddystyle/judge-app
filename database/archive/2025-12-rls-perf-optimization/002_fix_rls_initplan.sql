-- Migration: Fix RLS Initplan Performance Issues
-- Purpose: Optimize RLS policies to use subquery pattern instead of function re-evaluation
-- Impact: Significant performance improvement for queries on large tables
-- Risk: Medium (changes authentication logic, requires testing)
-- Date: 2025-11-30
-- IMPORTANT: Review and test each policy before applying to production

-- ============================================================
-- PATTERN EXPLANATION
-- ============================================================
-- Before: USING (user_id = auth.uid())
-- After:  USING (user_id = (SELECT auth.uid()))
--
-- The subquery pattern ensures auth.uid() is evaluated once per query
-- instead of once per row, dramatically improving performance.
-- ============================================================

-- ============================================================
-- PROFILES TABLE
-- ============================================================

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
TO authenticated
USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (id = (SELECT auth.uid()));

-- ============================================================
-- SESSIONS TABLE
-- ============================================================

DROP POLICY IF EXISTS "Users can view own sessions" ON sessions;
CREATE POLICY "Users can view own sessions"
ON sessions FOR SELECT
TO authenticated
USING (created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can create sessions" ON sessions;
CREATE POLICY "Users can create sessions"
ON sessions FOR INSERT
TO authenticated
WITH CHECK (created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own sessions" ON sessions;
CREATE POLICY "Users can update own sessions"
ON sessions FOR UPDATE
TO authenticated
USING (created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete own sessions" ON sessions;
CREATE POLICY "Users can delete own sessions"
ON sessions FOR DELETE
TO authenticated
USING (created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Chief judges can view sessions" ON sessions;
CREATE POLICY "Chief judges can view sessions"
ON sessions FOR SELECT
TO authenticated
USING (chief_judge_id = (SELECT auth.uid()));

-- ============================================================
-- SESSION_PARTICIPANTS TABLE
-- ============================================================

DROP POLICY IF EXISTS "Session creators can manage participants" ON session_participants;
CREATE POLICY "Session creators can manage participants"
ON session_participants FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = session_participants.session_id
    AND sessions.created_by = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "Participants can view themselves" ON session_participants;
CREATE POLICY "Participants can view themselves"
ON session_participants FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = session_participants.session_id
    AND sessions.created_by = (SELECT auth.uid())
  )
);

-- ============================================================
-- ORGANIZATION_MEMBERS TABLE
-- ============================================================

DROP POLICY IF EXISTS "Users can view their own memberships" ON organization_members;
CREATE POLICY "Users can view their own memberships"
ON organization_members FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Organization admins can view all members" ON organization_members;
CREATE POLICY "Organization admins can view all members"
ON organization_members FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = organization_members.organization_id
    AND om.user_id = (SELECT auth.uid())
    AND om.role = 'admin'
    AND om.removed_at IS NULL
  )
);

DROP POLICY IF EXISTS "Organization admins can delete members" ON organization_members;
CREATE POLICY "Organization admins can delete members"
ON organization_members FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = organization_members.organization_id
    AND om.user_id = (SELECT auth.uid())
    AND om.role = 'admin'
    AND om.removed_at IS NULL
  )
);

DROP POLICY IF EXISTS "Members can view active organization members" ON organization_members;
CREATE POLICY "Members can view active organization members"
ON organization_members FOR SELECT
TO authenticated
USING (
  removed_at IS NULL
  AND organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = (SELECT auth.uid())
    AND removed_at IS NULL
  )
);

DROP POLICY IF EXISTS "Admins can view removed members" ON organization_members;
CREATE POLICY "Admins can view removed members"
ON organization_members FOR SELECT
TO authenticated
USING (
  removed_at IS NOT NULL
  AND organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = (SELECT auth.uid())
    AND role = 'admin'
    AND removed_at IS NULL
  )
);

DROP POLICY IF EXISTS "Admins can remove members" ON organization_members;
CREATE POLICY "Admins can remove members"
ON organization_members FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = (SELECT auth.uid())
    AND role = 'admin'
    AND removed_at IS NULL
  )
  AND removed_at IS NULL
)
WITH CHECK (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = (SELECT auth.uid())
    AND role = 'admin'
    AND removed_at IS NULL
  )
);

-- ============================================================
-- ORGANIZATIONS TABLE (if needed)
-- ============================================================

DROP POLICY IF EXISTS "Organization members can view their organization" ON organizations;
CREATE POLICY "Organization members can view their organization"
ON organizations FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = organizations.id
    AND organization_members.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "Organization admins can update their organization" ON organizations;
CREATE POLICY "Organization admins can update their organization"
ON organizations FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = organizations.id
    AND organization_members.user_id = (SELECT auth.uid())
    AND organization_members.role = 'admin'
  )
);

-- ============================================================
-- CUSTOM_EVENTS TABLE
-- ============================================================

DROP POLICY IF EXISTS "Session creators can manage custom events" ON custom_events;
CREATE POLICY "Session creators can manage custom events"
ON custom_events FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = custom_events.session_id
    AND sessions.created_by = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "Participants can view custom events" ON custom_events;
CREATE POLICY "Participants can view custom events"
ON custom_events FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM session_participants sp
    WHERE sp.session_id = custom_events.session_id
    AND sp.user_id = (SELECT auth.uid())
  )
  OR
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = custom_events.session_id
    AND sessions.created_by = (SELECT auth.uid())
  )
);

-- ============================================================
-- RESULTS TABLE
-- ============================================================
-- Note: results table uses judge_name (text) instead of judge_id (UUID)
-- to support guest judges. Current policies are permissive (USING true)
-- to allow both authenticated and anonymous users.
-- The optimization here is minimal since no auth.uid() calls are used.

DROP POLICY IF EXISTS "Authenticated users can view results" ON results;
CREATE POLICY "Authenticated users can view results"
ON results FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert results" ON results;
CREATE POLICY "Authenticated users can insert results"
ON results FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update results" ON results;
CREATE POLICY "Authenticated users can update results"
ON results FOR UPDATE
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated users can delete results" ON results;
CREATE POLICY "Authenticated users can delete results"
ON results FOR DELETE
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Anonymous users can view results" ON results;
CREATE POLICY "Anonymous users can view results"
ON results FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "Anonymous users can insert results" ON results;
CREATE POLICY "Anonymous users can insert results"
ON results FOR INSERT
TO anon
WITH CHECK (true);

DROP POLICY IF EXISTS "Anonymous users can update results" ON results;
CREATE POLICY "Anonymous users can update results"
ON results FOR UPDATE
TO anon
USING (true);

-- ============================================================
-- TRAINING_EVENTS TABLE
-- ============================================================

DROP POLICY IF EXISTS "Session creators can manage training events" ON training_events;
CREATE POLICY "Session creators can manage training events"
ON training_events FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = training_events.session_id
    AND sessions.created_by = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "Participants can view training events" ON training_events;
CREATE POLICY "Participants can view training events"
ON training_events FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM session_participants sp
    WHERE sp.session_id = training_events.session_id
    AND sp.user_id = (SELECT auth.uid())
  )
  OR
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = training_events.session_id
    AND sessions.created_by = (SELECT auth.uid())
  )
);

-- ============================================================
-- TRAINING_SESSIONS TABLE
-- ============================================================

DROP POLICY IF EXISTS "Session creators can manage training sessions" ON training_sessions;
CREATE POLICY "Session creators can manage training sessions"
ON training_sessions FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = training_sessions.session_id
    AND sessions.created_by = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "Participants can view training sessions" ON training_sessions;
CREATE POLICY "Participants can view training sessions"
ON training_sessions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM session_participants sp
    WHERE sp.session_id = training_sessions.session_id
    AND sp.user_id = (SELECT auth.uid())
  )
  OR
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = training_sessions.session_id
    AND sessions.created_by = (SELECT auth.uid())
  )
);

-- ============================================================
-- TRAINING_SCORES TABLE
-- ============================================================
-- Note: training_scores has judge_id for authenticated users
-- and guest_identifier for guest users

DROP POLICY IF EXISTS "Authenticated users can view training scores in their sessions" ON training_scores;
CREATE POLICY "Authenticated users can view training scores in their sessions"
ON training_scores FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM training_events te
    JOIN training_sessions ts ON ts.session_id = te.session_id
    WHERE te.id = training_scores.event_id
    AND EXISTS (
      SELECT 1 FROM session_participants sp
      WHERE sp.session_id = te.session_id
      AND sp.user_id = (SELECT auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Authenticated users can insert their own training scores" ON training_scores;
CREATE POLICY "Authenticated users can insert their own training scores"
ON training_scores FOR INSERT
TO authenticated
WITH CHECK (
  judge_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM training_events te
    WHERE te.id = training_scores.event_id
    AND EXISTS (
      SELECT 1 FROM session_participants sp
      WHERE sp.session_id = te.session_id
      AND sp.user_id = (SELECT auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Authenticated users can update their own training scores" ON training_scores;
CREATE POLICY "Authenticated users can update their own training scores"
ON training_scores FOR UPDATE
TO authenticated
USING (judge_id = (SELECT auth.uid()))
WITH CHECK (judge_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Anonymous users can view training scores" ON training_scores;
CREATE POLICY "Anonymous users can view training scores"
ON training_scores FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "Anonymous users can insert training scores" ON training_scores;
CREATE POLICY "Anonymous users can insert training scores"
ON training_scores FOR INSERT
TO anon
WITH CHECK (
  guest_identifier IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM training_events te
    WHERE te.id = training_scores.event_id
    AND EXISTS (
      SELECT 1 FROM session_participants sp
      WHERE sp.session_id = te.session_id
      AND sp.guest_identifier = training_scores.guest_identifier
    )
  )
);

DROP POLICY IF EXISTS "Anonymous users can update their own training scores" ON training_scores;
CREATE POLICY "Anonymous users can update their own training scores"
ON training_scores FOR UPDATE
TO anon
USING (
  guest_identifier IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM session_participants sp
    JOIN training_events te ON te.session_id = sp.session_id
    WHERE te.id = training_scores.event_id
    AND sp.guest_identifier = training_scores.guest_identifier
  )
)
WITH CHECK (
  guest_identifier IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM session_participants sp
    JOIN training_events te ON te.session_id = sp.session_id
    WHERE te.id = training_scores.event_id
    AND sp.guest_identifier = training_scores.guest_identifier
  )
);

-- ============================================================
-- INVITATIONS TABLE
-- ============================================================

DROP POLICY IF EXISTS "Organization admins can create invitations" ON invitations;
CREATE POLICY "Organization admins can create invitations"
ON invitations FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = invitations.organization_id
    AND organization_members.user_id = (SELECT auth.uid())
    AND organization_members.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Organization admins can view invitations" ON invitations;
CREATE POLICY "Organization admins can view invitations"
ON invitations FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = invitations.organization_id
    AND organization_members.user_id = (SELECT auth.uid())
    AND organization_members.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Anyone can view valid invitation by token" ON invitations;
CREATE POLICY "Anyone can view valid invitation by token"
ON invitations FOR SELECT
TO authenticated
USING (
  expires_at > NOW()
  AND (max_uses IS NULL OR used_count < max_uses)
);

DROP POLICY IF EXISTS "Organization admins can delete invitations" ON invitations;
CREATE POLICY "Organization admins can delete invitations"
ON invitations FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = invitations.organization_id
    AND organization_members.user_id = (SELECT auth.uid())
    AND organization_members.role = 'admin'
  )
);

-- ============================================================
-- INVITATION_USES TABLE
-- ============================================================

DROP POLICY IF EXISTS "Organization admins can view invitation uses" ON invitation_uses;
CREATE POLICY "Organization admins can view invitation uses"
ON invitation_uses FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM invitations
    JOIN organization_members ON organization_members.organization_id = invitations.organization_id
    WHERE invitations.id = invitation_uses.invitation_id
    AND organization_members.user_id = (SELECT auth.uid())
    AND organization_members.role = 'admin'
  )
);

-- ============================================================
-- PARTICIPANTS TABLE
-- ============================================================

DROP POLICY IF EXISTS "Session creators can manage participants" ON participants;
CREATE POLICY "Session creators can manage participants"
ON participants FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = participants.session_id
    AND sessions.created_by = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "Participants can view participants" ON participants;
CREATE POLICY "Participants can view participants"
ON participants FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM session_participants sp
    WHERE sp.session_id = participants.session_id
    AND sp.user_id = (SELECT auth.uid())
  )
  OR
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = participants.session_id
    AND sessions.created_by = (SELECT auth.uid())
  )
);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- Run these queries after migration to verify policies are updated correctly

-- Check all policies on a specific table:
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'sessions'
-- ORDER BY policyname;

-- Test query performance before and after:
-- EXPLAIN ANALYZE SELECT * FROM sessions WHERE created_by = auth.uid();
-- EXPLAIN ANALYZE SELECT * FROM sessions WHERE created_by = (SELECT auth.uid());

-- ============================================================
-- IMPORTANT NOTES
-- ============================================================
-- 1. These policy names and conditions are based on common patterns.
--    You may need to adjust them based on your actual policy names.
--
-- 2. Test thoroughly in a development environment before applying to production.
--
-- 3. After applying, verify that all authentication flows still work correctly:
--    - Users can only see their own data
--    - Session creators can manage their sessions
--    - Judges can submit scores
--    - Organization admins can manage members
--
-- 4. Monitor query performance using pg_stat_statements after migration.
--
-- 5. If you have additional policies not covered here, apply the same pattern:
--    auth.uid() → (SELECT auth.uid())
--    auth.jwt() → (SELECT auth.jwt())
-- ============================================================
