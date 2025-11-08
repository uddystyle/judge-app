-- ===================================================================
-- organization_membersテーブルの最もシンプルなRLSポリシー
-- ===================================================================
-- 無限再帰を完全に回避するため、サブクエリを使わない
-- ===================================================================

-- すべてのポリシーを削除
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

-- 1. INSERTポリシー: ユーザーは自分自身のメンバーシップのみ作成できる
CREATE POLICY "insert_own_membership"
ON organization_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 2. SELECTポリシー: 認証済みユーザーはすべてのメンバーシップを閲覧可能
-- （後で必要に応じて制限を追加）
CREATE POLICY "select_all_memberships"
ON organization_members
FOR SELECT
TO authenticated
USING (true);

-- 3. UPDATEポリシー: 自分のメンバーシップのみ更新可能
CREATE POLICY "update_own_membership"
ON organization_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 4. DELETEポリシー: 自分のメンバーシップのみ削除可能
CREATE POLICY "delete_own_membership"
ON organization_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- RLSを有効化
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- 確認: ポリシー一覧を表示
SELECT
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename = 'organization_members'
ORDER BY cmd, policyname;
