-- ============================================================
-- Migration 051: organization_members RLS無限再帰の修正
-- ============================================================
-- 実行日: 2025-11-23
-- 説明: マイグレーション047で作成したRLSポリシーの無限再帰を修正
-- ============================================================

-- ============================================================
-- 1. 問題のあるポリシーを削除
-- ============================================================

DROP POLICY IF EXISTS "Members can view active organization members" ON organization_members;
DROP POLICY IF EXISTS "Admins can view removed members" ON organization_members;

-- ============================================================
-- 2. 修正されたポリシーを作成
-- ============================================================

-- ユーザーは自分のメンバーシップを閲覧可能（削除済みも含む、削除日時確認のため）
CREATE POLICY "Users can view own memberships"
ON organization_members FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 管理者は同じ組織の全メンバーを閲覧可能（削除済みも含む）
CREATE POLICY "Admins can view all organization members"
ON organization_members FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members AS om
    WHERE om.organization_id = organization_members.organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'admin'
      AND om.removed_at IS NULL
  )
);

-- ============================================================
-- 完了
-- ============================================================
-- マイグレーション完了！
-- ダッシュボードが正常に動作するようになります
-- ============================================================
