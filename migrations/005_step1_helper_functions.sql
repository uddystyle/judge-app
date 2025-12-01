-- ============================================================
-- Step 1: Helper Functions のみ作成
-- ============================================================
-- これを最初に実行してください
-- リスク: 低（関数を作るだけ、既存の動作に影響なし）
-- ============================================================

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

-- Get user's organization IDs
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

-- Check if user is organization admin
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_current_user_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION is_session_creator(BIGINT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION is_session_participant(BIGINT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_user_organization_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION is_organization_admin(UUID) TO authenticated;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✓ Step 1 完了: Helper関数が作成されました';
  RAISE NOTICE '次のステップ: 005_step2_profiles.sql を実行してください';
END $$;
