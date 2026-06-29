-- ============================================================
-- EMERGENCY ROLLBACK: Restore Original RLS Policies
-- ============================================================
-- This script restores the original RLS policies that were
-- working before the 002_fix_rls_initplan.sql migration.
-- ============================================================

-- ============================================================
-- PROFILES TABLE - Restore Original
-- ============================================================

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Users can insert own profile"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- ============================================================
-- SESSIONS TABLE - Restore Original
-- ============================================================

DROP POLICY IF EXISTS "Users can view own sessions" ON sessions;
DROP POLICY IF EXISTS "Users can create sessions" ON sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON sessions;
DROP POLICY IF EXISTS "Users can delete own sessions" ON sessions;
DROP POLICY IF EXISTS "Chief judges can view sessions" ON sessions;
DROP POLICY IF EXISTS "Organization members can view organization sessions" ON sessions;

CREATE POLICY "Users can view own sessions"
ON sessions FOR SELECT
TO authenticated
USING (created_by = auth.uid());

CREATE POLICY "Users can create sessions"
ON sessions FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update own sessions"
ON sessions FOR UPDATE
TO authenticated
USING (created_by = auth.uid());

CREATE POLICY "Users can delete own sessions"
ON sessions FOR DELETE
TO authenticated
USING (created_by = auth.uid());

CREATE POLICY "Chief judges can view sessions"
ON sessions FOR SELECT
TO authenticated
USING (chief_judge_id = auth.uid());

CREATE POLICY "Organization members can view organization sessions"
ON sessions FOR SELECT
USING (
  organization_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = sessions.organization_id
      AND organization_members.user_id = auth.uid()
  )
);

-- ============================================================
-- SESSION_PARTICIPANTS TABLE - Restore Original
-- ============================================================

DROP POLICY IF EXISTS "Session creators can manage participants" ON session_participants;
DROP POLICY IF EXISTS "Participants can view themselves" ON session_participants;

-- Note: Exact policy names may vary - adjust as needed
CREATE POLICY "Users can view their own participations"
ON session_participants FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- ============================================================
-- ORGANIZATION_MEMBERS TABLE - Restore Original
-- ============================================================

DROP POLICY IF EXISTS "Users can view their own memberships" ON organization_members;
DROP POLICY IF EXISTS "Organization admins can view all members" ON organization_members;
DROP POLICY IF EXISTS "Organization admins can delete members" ON organization_members;
DROP POLICY IF EXISTS "Members can view active organization members" ON organization_members;
DROP POLICY IF EXISTS "Admins can view removed members" ON organization_members;
DROP POLICY IF EXISTS "Admins can remove members" ON organization_members;

CREATE POLICY "Users can view their own memberships"
ON organization_members FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Members can view active organization members"
ON organization_members FOR SELECT
TO authenticated
USING (
  removed_at IS NULL AND
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND removed_at IS NULL
  )
);

CREATE POLICY "Admins can view removed members"
ON organization_members FOR SELECT
TO authenticated
USING (
  removed_at IS NOT NULL AND
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
    AND removed_at IS NULL
  )
);

CREATE POLICY "Admins can remove members"
ON organization_members FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
    AND removed_at IS NULL
  )
  AND removed_at IS NULL
)
WITH CHECK (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
    AND removed_at IS NULL
  )
);

-- ============================================================
-- ORGANIZATIONS TABLE - Restore Original
-- ============================================================

DROP POLICY IF EXISTS "Organization members can view their organization" ON organizations;
DROP POLICY IF EXISTS "Organization admins can update their organization" ON organizations;

CREATE POLICY "Organization members can view their organization"
ON organizations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = organizations.id
      AND organization_members.user_id = auth.uid()
  )
);

CREATE POLICY "Organization admins can update their organization"
ON organizations FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = organizations.id
      AND organization_members.user_id = auth.uid()
      AND organization_members.role = 'admin'
  )
);

-- ============================================================
-- INVITATIONS TABLE - Restore Original
-- ============================================================

DROP POLICY IF EXISTS "Organization admins can create invitations" ON invitations;
DROP POLICY IF EXISTS "Organization admins can view invitations" ON invitations;
DROP POLICY IF EXISTS "Anyone can view valid invitation by token" ON invitations;
DROP POLICY IF EXISTS "Organization admins can delete invitations" ON invitations;

CREATE POLICY "Organization admins can create invitations"
ON invitations FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = invitations.organization_id
      AND organization_members.user_id = auth.uid()
      AND organization_members.role = 'admin'
  )
);

CREATE POLICY "Organization admins can view invitations"
ON invitations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = invitations.organization_id
      AND organization_members.user_id = auth.uid()
      AND organization_members.role = 'admin'
  )
);

CREATE POLICY "Anyone can view valid invitation by token"
ON invitations FOR SELECT
USING (
  expires_at > NOW()
  AND (max_uses IS NULL OR used_count < max_uses)
);

CREATE POLICY "Organization admins can delete invitations"
ON invitations FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = invitations.organization_id
      AND organization_members.user_id = auth.uid()
      AND organization_members.role = 'admin'
  )
);

-- ============================================================
-- Note: Other tables (results, training_scores, etc.) were
-- not significantly changed and should still work.
-- ============================================================

-- ============================================================
-- VERIFICATION
-- ============================================================
-- After running this rollback, test:
-- 1. Login
-- 2. View profile
-- 3. View organizations
-- 4. View sessions
-- ============================================================
