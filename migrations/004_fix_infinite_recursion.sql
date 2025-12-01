-- ============================================================
-- Fix Infinite Recursion in organization_members RLS
-- ============================================================
-- Problem: organization_members policies reference themselves
-- causing infinite recursion
-- Solution: Use SECURITY DEFINER helper function
-- ============================================================

-- ============================================================
-- 1. Drop problematic policies
-- ============================================================

DROP POLICY IF EXISTS "Members can view active organization members" ON organization_members;
DROP POLICY IF EXISTS "Admins can view removed members" ON organization_members;
DROP POLICY IF EXISTS "Admins can remove members" ON organization_members;

-- ============================================================
-- 2. Helper function to check if user is organization admin
-- ============================================================
-- This function already exists from migration 007, but we ensure it's correct

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. Helper function to get user's organization IDs
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_organization_ids()
RETURNS SETOF UUID AS $$
BEGIN
  RETURN QUERY
  SELECT organization_id
  FROM organization_members
  WHERE user_id = auth.uid()
    AND removed_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. Recreate policies WITHOUT self-reference
-- ============================================================

-- Users can always view their own memberships (no recursion)
-- This policy is already correct - keep as is
-- (Already exists from previous migration)

-- Organization members can view other active members
-- Use helper function to avoid recursion
CREATE POLICY "Members can view organization members"
ON organization_members FOR SELECT
TO authenticated
USING (
  removed_at IS NULL
  AND organization_id IN (SELECT get_user_organization_ids())
);

-- Organization admins can view removed members
-- Use helper function to avoid recursion
CREATE POLICY "Admins can view removed members"
ON organization_members FOR SELECT
TO authenticated
USING (
  removed_at IS NOT NULL
  AND is_organization_admin(organization_id)
);

-- Organization admins can remove (soft delete) members
-- Use helper function to avoid recursion
CREATE POLICY "Admins can remove members"
ON organization_members FOR UPDATE
TO authenticated
USING (
  removed_at IS NULL
  AND is_organization_admin(organization_id)
)
WITH CHECK (
  is_organization_admin(organization_id)
);

-- ============================================================
-- 5. Grant execute permissions on helper functions
-- ============================================================

GRANT EXECUTE ON FUNCTION is_organization_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_organization_ids() TO authenticated;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- After running this migration, test:
-- 1. Login
-- 2. View organizations
-- 3. View organization members
-- 4. Check for infinite recursion error
-- ============================================================
