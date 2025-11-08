-- ============================================================
-- 019: organization_members の無限再帰RLSポリシー修正
-- ============================================================

-- すべての既存ポリシーを削除
DROP POLICY IF EXISTS "Organization members can view members" ON organization_members;
DROP POLICY IF EXISTS "Admins or self can delete members" ON organization_members;
DROP POLICY IF EXISTS "select_all_memberships" ON organization_members;
DROP POLICY IF EXISTS "insert_own_membership" ON organization_members;
DROP POLICY IF EXISTS "update_own_membership" ON organization_members;
DROP POLICY IF EXISTS "delete_own_membership" ON organization_members;

-- シンプルで再帰しないポリシーを作成

-- SELECT: すべての認証済みユーザーが閲覧可能（再帰を避けるため）
CREATE POLICY "select_all_memberships"
ON organization_members
FOR SELECT
TO authenticated
USING (true);

-- INSERT: 自分自身のみ追加可能
CREATE POLICY "insert_own_membership"
ON organization_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- UPDATE: 自分自身のレコードのみ更新可能
CREATE POLICY "update_own_membership"
ON organization_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- DELETE: 自分自身のレコードのみ削除可能
CREATE POLICY "delete_own_membership"
ON organization_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid());
