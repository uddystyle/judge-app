-- ===================================================================
-- organizationsテーブルのRLSポリシーを修正
-- ===================================================================
-- 問題: ユーザーが組織を作成しようとするとRLSエラーが発生
-- 解決: 認証済みユーザーが組織を作成できるようにINSERTポリシーを追加
-- ===================================================================

-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Users can create organizations" ON organizations;
DROP POLICY IF EXISTS "Users can view their organizations" ON organizations;
DROP POLICY IF EXISTS "Organization admins can update organization" ON organizations;
DROP POLICY IF EXISTS "Organization admins can delete organization" ON organizations;

-- 1. 認証済みユーザーは組織を作成できる（INSERT）
CREATE POLICY "Users can create organizations"
ON organizations
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 2. 組織メンバーは自分の組織を閲覧できる（SELECT）
CREATE POLICY "Users can view their organizations"
ON organizations
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
  )
);

-- 3. 組織の管理者は組織情報を更新できる（UPDATE）
CREATE POLICY "Organization admins can update organization"
ON organizations
FOR UPDATE
TO authenticated
USING (
  id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
)
WITH CHECK (
  id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);

-- 4. 組織の管理者は組織を削除できる（DELETE）
CREATE POLICY "Organization admins can delete organization"
ON organizations
FOR DELETE
TO authenticated
USING (
  id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);

-- RLSが有効になっているか確認
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- 確認クエリ：organizationsテーブルのポリシー一覧を表示
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
WHERE tablename = 'organizations'
ORDER BY policyname;
