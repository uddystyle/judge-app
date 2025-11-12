-- Migration: Add RLS policy for guest users to view sessions via invite token
-- Description: 未認証のゲストユーザーが招待トークンでセッションを読み取れるようにする
-- Date: 2025-11-12

-- 匿名ユーザー（未認証）が招待トークンでセッションを読み取れるポリシーを追加
CREATE POLICY "Anonymous users can view sessions via invite token"
  ON sessions FOR SELECT
  TO anon
  USING (invite_token IS NOT NULL);

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 032_add_guest_invite_policy.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '- Added SELECT policy for anonymous users to view sessions via invite_token';
  RAISE NOTICE '- Guest users can now access sessions through invite links';
  RAISE NOTICE '=================================================================';
END $$;
