-- Migration: Add missing INSERT policy for session_participants
-- Description: 030のマイグレーションでINSERTポリシーが再作成されていなかったため追加
-- Date: 2025-11-12

-- session_participants テーブルにINSERTポリシーを追加
CREATE POLICY "Authenticated users can insert session participants"
  ON session_participants FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Anonymous users can insert session participants"
  ON session_participants FOR INSERT
  TO anon
  WITH CHECK (true);

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 031_add_missing_session_participants_insert_policy.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '- Added INSERT policies for session_participants';
  RAISE NOTICE '- Users can now be added as participants when creating sessions';
  RAISE NOTICE '=================================================================';
END $$;
