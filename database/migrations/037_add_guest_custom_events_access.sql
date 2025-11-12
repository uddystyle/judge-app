-- Migration: Allow anonymous users to view custom events
-- Description: ゲストユーザーが大会モードの種目情報を読み取れるようにする
-- Date: 2025-11-12

-- 匿名ユーザー（ゲスト）がcustom_eventsを読み取れるポリシーを追加
CREATE POLICY "Anonymous users can view custom events"
  ON custom_events FOR SELECT
  TO anon
  USING (true);

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 037_add_guest_custom_events_access.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '- Added SELECT policy for anonymous users on custom_events';
  RAISE NOTICE '- Guest users can now view tournament event details';
  RAISE NOTICE '- This fixes 404 errors when guests access scoring pages';
  RAISE NOTICE '=================================================================';
END $$;
