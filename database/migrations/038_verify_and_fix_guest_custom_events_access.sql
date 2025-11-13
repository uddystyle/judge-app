-- Migration: Verify and fix anonymous user access to custom_events
-- Description: 本番環境でゲストユーザーがcustom_eventsにアクセスできるか確認し、修正する
-- Date: 2025-11-13

-- 現在のポリシーを確認
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Checking existing RLS policies on custom_events table';
  RAISE NOTICE '=================================================================';
END $$;

-- custom_eventsテーブルの既存ポリシーを表示
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'custom_events'
ORDER BY policyname;

-- 既存のanonユーザー用ポリシーを削除（存在する場合）
DROP POLICY IF EXISTS "Anonymous users can view custom events" ON custom_events;

-- 新しいポリシーを作成: 匿名ユーザーがすべてのcustom_eventsを読み取れるようにする
CREATE POLICY "Anonymous users can view custom events"
  ON custom_events FOR SELECT
  TO anon
  USING (true);

-- RLSが有効になっているか確認
DO $$
DECLARE
  rls_enabled boolean;
BEGIN
  SELECT relrowsecurity INTO rls_enabled
  FROM pg_class
  WHERE relname = 'custom_events';

  IF rls_enabled THEN
    RAISE NOTICE 'RLS is ENABLED on custom_events table';
  ELSE
    RAISE NOTICE 'RLS is DISABLED on custom_events table';
  END IF;
END $$;

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 038_verify_and_fix_guest_custom_events_access.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '- Verified and recreated SELECT policy for anonymous users';
  RAISE NOTICE '- Guest users can now view all custom events (tournament events)';
  RAISE NOTICE '- This fixes 404 errors when guests access scoring pages';
  RAISE NOTICE '=================================================================';
END $$;
