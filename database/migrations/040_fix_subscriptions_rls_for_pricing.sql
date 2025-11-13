-- Migration: Fix RLS policies for subscriptions table to allow pricing page access
-- Description: 認証済みユーザーが自分の組織のサブスクリプション情報を読み取れるようにする
-- Date: 2025-11-13

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Fixing subscriptions table RLS policies for pricing page';
  RAISE NOTICE '=================================================================';
END $$;

-- 現在のsubscriptionsテーブルのポリシーを確認
SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual
FROM pg_policies
WHERE tablename = 'subscriptions'
ORDER BY policyname;

-- 既存のSELECTポリシーを削除
DROP POLICY IF EXISTS "Users can view their own subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Organization members can view organization subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Authenticated users can view subscriptions" ON subscriptions;

-- 新しいポリシー: 認証済みユーザーが自分の組織のサブスクリプションを読み取れる
CREATE POLICY "Organization members can view organization subscriptions"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
    )
    OR user_id = auth.uid()
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Created SELECT policy for authenticated users on subscriptions';
END $$;

-- 確認: 新しいポリシーを表示
SELECT
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename = 'subscriptions'
ORDER BY policyname;

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 040_fix_subscriptions_rls_for_pricing.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '- Organization members can now view their organization subscriptions';
  RAISE NOTICE '- Users can view their own personal subscriptions';
  RAISE NOTICE '- Pricing page will now display correct billing interval';
  RAISE NOTICE '=================================================================';
END $$;
