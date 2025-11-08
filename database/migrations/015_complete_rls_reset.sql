-- ===================================================================
-- organization_membersテーブルのRLSポリシーを完全にリセット
-- ===================================================================
-- すべてのポリシーを削除して、シンプルなポリシーのみを再作成
-- ===================================================================

-- organization_membersテーブルのすべてのポリシーを削除
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'organization_members')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON organization_members', r.policyname);
        RAISE NOTICE 'Dropped policy: %', r.policyname;
    END LOOP;
END $$;

-- 1. INSERTポリシー: ユーザーは自分自身のメンバーシップを作成できる
-- これだけで組織作成時のメンバー追加が可能
CREATE POLICY "Users can insert their own membership"
ON organization_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 2. SELECTポリシー: ユーザーは自分が所属する組織のメンバーを閲覧できる
-- サブクエリを使わず、直接user_idをチェック
CREATE POLICY "Users can view members where they are member"
ON organization_members
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = organization_members.organization_id
    AND om.user_id = auth.uid()
  )
);

-- 3. UPDATEポリシー: 自分のメンバーシップは更新可能（ロール変更は別途制御）
CREATE POLICY "Users can update their own membership"
ON organization_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 4. DELETEポリシー: ユーザーは自分のメンバーシップを削除できる（組織から退出）
CREATE POLICY "Users can delete their own membership"
ON organization_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- RLSを有効化
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- 確認: 新しいポリシー一覧を表示
SELECT
  policyname,
  cmd,
  roles,
  CASE
    WHEN qual IS NOT NULL THEN 'USING defined'
    ELSE 'No USING'
  END as using_clause,
  CASE
    WHEN with_check IS NOT NULL THEN 'WITH CHECK defined'
    ELSE 'No WITH CHECK'
  END as with_check_clause
FROM pg_policies
WHERE tablename = 'organization_members'
ORDER BY cmd, policyname;
