-- ===================================================================
-- organization_membersテーブルのRLSポリシーを修正
-- ===================================================================
-- 組織作成時にユーザーを管理者として追加できるようにする
-- ===================================================================

-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Users can join organizations" ON organization_members;
DROP POLICY IF EXISTS "Users can view organization members" ON organization_members;
DROP POLICY IF EXISTS "Organization admins can manage members" ON organization_members;
DROP POLICY IF EXISTS "Users can view their own membership" ON organization_members;
DROP POLICY IF EXISTS "Organization admins can add members" ON organization_members;
DROP POLICY IF EXISTS "Organization admins can remove members" ON organization_members;

-- 1. ユーザーは自分のメンバーシップレコードを作成できる（INSERT）
-- 組織作成時や招待受諾時に必要
CREATE POLICY "Users can create their own membership"
ON organization_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 2. 組織管理者は他のメンバーを追加できる（INSERT）
CREATE POLICY "Organization admins can add members"
ON organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);

-- 3. ユーザーは自分が所属する組織のメンバー一覧を閲覧できる（SELECT）
CREATE POLICY "Users can view their organization members"
ON organization_members
FOR SELECT
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
  )
);

-- 4. 組織管理者はメンバーを更新できる（UPDATE）
CREATE POLICY "Organization admins can update members"
ON organization_members
FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
)
WITH CHECK (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);

-- 5. 組織管理者はメンバーを削除できる（DELETE）
CREATE POLICY "Organization admins can remove members"
ON organization_members
FOR DELETE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);

-- 6. ユーザーは自分のメンバーシップを削除できる（組織から退出）
CREATE POLICY "Users can leave organizations"
ON organization_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- RLSが有効になっているか確認
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- 確認クエリ：organization_membersテーブルのポリシー一覧を表示
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
WHERE tablename = 'organization_members'
ORDER BY policyname;
