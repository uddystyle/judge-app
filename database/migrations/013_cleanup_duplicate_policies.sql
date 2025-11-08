-- ===================================================================
-- 重複した古いRLSポリシーをクリーンアップ
-- ===================================================================

-- organization_membersテーブルの古いポリシーを削除
DROP POLICY IF EXISTS "Organization admins can delete members" ON organization_members;
DROP POLICY IF EXISTS "Organization admins can view all members" ON organization_members;
DROP POLICY IF EXISTS "Users can view their own memberships" ON organization_members;

-- 確認：残っているポリシーを表示
SELECT
  tablename,
  policyname,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'organization_members'
ORDER BY cmd, policyname;
