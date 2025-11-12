-- Migration: Fix participants table RLS policies
-- Description: 033のポリシーを削除して、元の仕様に沿った正しいポリシーを再作成
-- Date: 2025-11-12

-- 既存のポリシーを全て削除
DROP POLICY IF EXISTS "Authenticated users can view participants" ON participants;
DROP POLICY IF EXISTS "Anonymous users can view participants" ON participants;
DROP POLICY IF EXISTS "Authenticated users can insert participants" ON participants;
DROP POLICY IF EXISTS "Authenticated users can update participants" ON participants;
DROP POLICY IF EXISTS "Authenticated users can delete participants" ON participants;

-- 元の仕様に沿ったポリシーを再作成

-- SELECT: セッション参加者と匿名ユーザー（ゲスト）が閲覧可能
CREATE POLICY "Session participants can view participants"
  ON participants FOR SELECT
  TO authenticated
  USING (
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Anonymous users can view participants"
  ON participants FOR SELECT
  TO anon
  USING (true);

-- INSERT: セッション作成者または主任検定員が作成可能
CREATE POLICY "Session creators can insert participants"
  ON participants FOR INSERT
  TO authenticated
  WITH CHECK (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
         OR chief_judge_id = auth.uid()
    )
  );

-- UPDATE: セッション作成者または主任検定員が更新可能
CREATE POLICY "Session creators can update participants"
  ON participants FOR UPDATE
  TO authenticated
  USING (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
         OR chief_judge_id = auth.uid()
    )
  );

-- DELETE: セッション作成者または主任検定員が削除可能
CREATE POLICY "Session creators can delete participants"
  ON participants FOR DELETE
  TO authenticated
  USING (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
         OR chief_judge_id = auth.uid()
    )
  );

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 034_fix_participants_policies.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '- Fixed SELECT policy for authenticated users (session participants only)';
  RAISE NOTICE '- Fixed INSERT, UPDATE, DELETE policies (session creators and chief judges only)';
  RAISE NOTICE '- Anonymous users (guests) can view all participants';
  RAISE NOTICE '=================================================================';
END $$;
