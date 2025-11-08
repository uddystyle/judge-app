-- ============================================================
-- 020: organizations テーブルのRLSポリシー修正
-- ============================================================

-- 既存のポリシーを削除
DROP POLICY IF EXISTS "insert_organization" ON organizations;
DROP POLICY IF EXISTS "Members can view their organization" ON organizations;
DROP POLICY IF EXISTS "Admins can update their organization" ON organizations;
DROP POLICY IF EXISTS "Admins can delete their organization" ON organizations;

-- 組織の作成: 認証済みユーザーのみ（誰でも作成可能）
CREATE POLICY "Authenticated users can create organizations"
  ON organizations FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 組織の閲覧: メンバーのみ
CREATE POLICY "Members can view their organization"
  ON organizations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
    )
  );

-- 組織の更新: 管理者のみ
CREATE POLICY "Admins can update their organization"
  ON organizations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- 組織の削除: 管理者のみ
CREATE POLICY "Admins can delete their organization"
  ON organizations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );
