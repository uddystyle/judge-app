-- ===================================================================
-- RLSの無限再帰エラーを修正
-- ===================================================================
-- 問題: "Organization admins can add members"ポリシーが
--       organization_membersテーブルを参照しているため無限再帰が発生
-- 解決: 組織作成時は、INSERTポリシーをシンプルにする
-- ===================================================================

-- 無限再帰を引き起こすポリシーを削除
DROP POLICY IF EXISTS "Organization admins can add members" ON organization_members;

-- このポリシーだけで組織作成時のメンバー追加が可能
-- "Users can create their own membership" は既に存在

-- 確認: 残っているポリシーを表示
SELECT
  tablename,
  policyname,
  roles,
  cmd,
  with_check
FROM pg_policies
WHERE tablename = 'organization_members'
AND cmd = 'INSERT'
ORDER BY policyname;
