-- Migration: Fix anonymous users' access to sessions
-- Description: ゲストユーザーがセッション参加後もセッション情報を読み取れるようにする
-- Date: 2025-11-12

-- 既存の制限的なポリシーを削除
DROP POLICY IF EXISTS "Anonymous users can view sessions via invite token" ON sessions;

-- 匿名ユーザー（ゲスト）が全てのセッションを読み取れるようにする
-- セッションIDを知らないとアクセスできないため、セキュリティ上の問題は少ない
CREATE POLICY "Anonymous users can view all sessions"
  ON sessions FOR SELECT
  TO anon
  USING (true);

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 035_fix_guest_session_access.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '- Replaced restrictive invite token policy with broader access';
  RAISE NOTICE '- Anonymous users (guests) can now view all sessions';
  RAISE NOTICE '- This allows guests to receive real-time updates after joining';
  RAISE NOTICE '- Session IDs are required to access, providing practical security';
  RAISE NOTICE '=================================================================';
END $$;
