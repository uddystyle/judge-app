-- ============================================================
-- Migration: Add Anonymous Access Policy for training_sessions
-- Description: Allow anonymous users (guests) to read training_sessions
-- Date: 2025-01-13
-- ============================================================

-- training_sessionsテーブルに匿名ユーザーのSELECTポリシーを追加
CREATE POLICY "Anonymous users can view training sessions"
  ON training_sessions
  FOR SELECT
  TO anon
  USING (
    -- セッションに参加しているゲストユーザーは閲覧可能
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE is_guest = true
    )
  );

-- ============================================================
-- Verification queries (commented out)
-- ============================================================
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd
-- FROM pg_policies
-- WHERE tablename = 'training_sessions';
