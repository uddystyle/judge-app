-- Migration: Allow anonymous users to view scoring prompts
-- Description: ゲストユーザーが採点指示を読み取れるようにする
-- Date: 2025-11-12

-- 匿名ユーザー（ゲスト）がscoring_promptsを読み取れるポリシーを追加
CREATE POLICY "Anonymous users can view scoring prompts"
  ON scoring_prompts FOR SELECT
  TO anon
  USING (true);

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 036_add_guest_scoring_prompts_access.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '- Added SELECT policy for anonymous users on scoring_prompts';
  RAISE NOTICE '- Guest users can now view scoring prompts';
  RAISE NOTICE '- This allows guests to receive and process scoring instructions';
  RAISE NOTICE '=================================================================';
END $$;
