-- Migration: Comprehensive fix for guest user access in tournament mode
-- Description: ゲストユーザーが大会モードで必要なすべてのテーブルにアクセスできるようにする
-- Date: 2025-11-13

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Starting comprehensive guest access fix';
  RAISE NOTICE '=================================================================';
END $$;

-- 1. custom_events テーブル: 匿名ユーザーが種目情報を読み取れるようにする
-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Anonymous users can view custom events" ON custom_events;

-- 新しいポリシーを作成
CREATE POLICY "Anonymous users can view custom events"
  ON custom_events FOR SELECT
  TO anon
  USING (true);

DO $$
BEGIN
  RAISE NOTICE '✓ Added SELECT policy for anonymous users on custom_events';
END $$;

-- 2. sessions テーブル: 匿名ユーザーがセッション情報を読み取れるようにする
-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Anonymous users can view sessions" ON sessions;

-- 新しいポリシーを作成
CREATE POLICY "Anonymous users can view sessions"
  ON sessions FOR SELECT
  TO anon
  USING (true);

DO $$
BEGIN
  RAISE NOTICE '✓ Added SELECT policy for anonymous users on sessions';
END $$;

-- 3. session_participants テーブル: 匿名ユーザーが自分のゲスト情報を読み取れるようにする
-- 既存のポリシーを確認
DROP POLICY IF EXISTS "Anonymous users can view their guest participation" ON session_participants;

-- 新しいポリシーを作成（すべてのsession_participantsを読み取れるようにする）
-- 理由: ゲストユーザーは認証されていないため、自分のレコードだけを特定する方法がない
CREATE POLICY "Anonymous users can view session participants"
  ON session_participants FOR SELECT
  TO anon
  USING (true);

DO $$
BEGIN
  RAISE NOTICE '✓ Added SELECT policy for anonymous users on session_participants';
END $$;

-- 4. scoring_prompts テーブル: 匿名ユーザーが採点指示を読み取れるようにする
DROP POLICY IF EXISTS "Anonymous users can view scoring prompts" ON scoring_prompts;

CREATE POLICY "Anonymous users can view scoring prompts"
  ON scoring_prompts FOR SELECT
  TO anon
  USING (true);

DO $$
BEGIN
  RAISE NOTICE '✓ Added SELECT policy for anonymous users on scoring_prompts';
END $$;

-- 5. participants テーブル: 匿名ユーザーが参加者情報を読み取れるようにする
DROP POLICY IF EXISTS "Anonymous users can view participants" ON participants;

CREATE POLICY "Anonymous users can view participants"
  ON participants FOR SELECT
  TO anon
  USING (true);

DO $$
BEGIN
  RAISE NOTICE '✓ Added SELECT policy for anonymous users on participants';
END $$;

-- 現在のポリシーを確認
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Current RLS policies for anonymous users:';
  RAISE NOTICE '=================================================================';
END $$;

SELECT
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE 'anon'::text = ANY(roles::text[])
ORDER BY tablename, policyname;

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 039_comprehensive_guest_access_fix.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '- Added SELECT policies for anonymous users on:';
  RAISE NOTICE '  * custom_events (tournament event details)';
  RAISE NOTICE '  * sessions (session information)';
  RAISE NOTICE '  * session_participants (guest participation)';
  RAISE NOTICE '  * scoring_prompts (scoring instructions)';
  RAISE NOTICE '  * participants (athlete information)';
  RAISE NOTICE '- Guest users can now fully access tournament mode scoring';
  RAISE NOTICE '=================================================================';
END $$;
