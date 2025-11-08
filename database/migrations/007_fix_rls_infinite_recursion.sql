-- ============================================================
-- RLS無限再帰エラーの修正パッチ
-- ============================================================
-- 実行日: 2025-11-06
-- 説明: organization_members テーブルのRLSポリシーで発生していた
--       無限再帰エラーを修正
-- ============================================================

-- 問題のあるポリシーを削除
DROP POLICY IF EXISTS "Organization members can view organization members" ON organization_members;
DROP POLICY IF EXISTS "Organization admins can insert members" ON organization_members;
DROP POLICY IF EXISTS "Organization admins can delete members" ON organization_members;
DROP POLICY IF EXISTS "Organization members can view members" ON organization_members;
DROP POLICY IF EXISTS "Organization admins can view all members" ON organization_members;
DROP POLICY IF EXISTS "Users can view their own memberships" ON organization_members;

-- ヘルパー関数：組織の管理者かどうかをチェック（無限再帰回避）
CREATE OR REPLACE FUNCTION is_organization_admin(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ユーザーは自分のメンバーシップを閲覧可能
CREATE POLICY "Users can view their own memberships"
  ON organization_members FOR SELECT
  USING (user_id = auth.uid());

-- 管理者は同じ組織の全メンバーを閲覧可能
CREATE POLICY "Organization admins can view all members"
  ON organization_members FOR SELECT
  USING (is_organization_admin(organization_id));

-- 組織の管理者はメンバーを削除可能
CREATE POLICY "Organization admins can delete members"
  ON organization_members FOR DELETE
  USING (is_organization_admin(organization_id));

-- ============================================================
-- 完了
-- ============================================================
-- 無限再帰エラーが修正されました
-- ============================================================
