-- ============================================================
-- Migration 052: SECURITY DEFINER関数を使用してRLS無限再帰を完全修正
-- ============================================================
-- 実行日: 2025-11-23
-- 説明: organization_membersのRLS無限再帰を完全に解決
-- ============================================================

-- ============================================================
-- 1. すべての既存ポリシーを一旦削除
-- ============================================================

DROP POLICY IF EXISTS "Users can view own memberships" ON organization_members;
DROP POLICY IF EXISTS "Admins can view all organization members" ON organization_members;
DROP POLICY IF EXISTS "Users can view their own memberships" ON organization_members;
DROP POLICY IF EXISTS "Organization admins can view all members" ON organization_members;
DROP POLICY IF EXISTS "Organization admins can delete members" ON organization_members;

-- ============================================================
-- 2. SECURITY DEFINER ヘルパー関数を作成
-- ============================================================

-- ユーザーが組織のメンバーかチェック（RLSをバイパス）
CREATE OR REPLACE FUNCTION is_organization_member(org_id UUID, check_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = check_user_id
      AND removed_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ユーザーが組織の管理者かチェック（RLSをバイパス）
-- 既存の関数を更新して removed_at チェックを追加
CREATE OR REPLACE FUNCTION is_organization_admin(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role = 'admin'
      AND removed_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. 新しいRLSポリシーを作成（SECURITY DEFINER関数を使用）
-- ============================================================

-- ユーザーは自分のメンバーシップを閲覧可能（アクティブ・削除済み両方）
CREATE POLICY "Users can view own memberships"
ON organization_members FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 管理者は同じ組織の全メンバーを閲覧可能（アクティブ・削除済み両方）
CREATE POLICY "Admins can view org members"
ON organization_members FOR SELECT
TO authenticated
USING (is_organization_admin(organization_id));

-- メンバーは同じ組織のアクティブメンバーを閲覧可能
CREATE POLICY "Members can view active org members"
ON organization_members FOR SELECT
TO authenticated
USING (
  removed_at IS NULL
  AND is_organization_member(organization_id, auth.uid())
);

-- 管理者はメンバーを削除可能（Soft Delete用）
CREATE POLICY "Admins can update members"
ON organization_members FOR UPDATE
TO authenticated
USING (is_organization_admin(organization_id))
WITH CHECK (is_organization_admin(organization_id));

-- ============================================================
-- 完了
-- ============================================================
-- マイグレーション完了！
-- SECURITY DEFINER関数がRLSをバイパスするため、無限再帰は発生しません
-- ============================================================
