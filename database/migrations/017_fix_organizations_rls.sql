-- ===================================================================
-- organizationsテーブルのRLSポリシーを修正
-- ===================================================================
-- 認証済みユーザーが組織を作成できるようにする
-- ===================================================================

-- 既存のポリシーをすべて削除
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'organizations')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON organizations', r.policyname);
        RAISE NOTICE 'Dropped policy: %', r.policyname;
    END LOOP;
END $$;

-- 1. INSERTポリシー: 認証済みユーザーは組織を作成できる
CREATE POLICY "insert_organization"
ON organizations
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 2. SELECTポリシー: 認証済みユーザーはすべての組織を閲覧できる
-- （後で自分が所属する組織のみに制限可能）
CREATE POLICY "select_organization"
ON organizations
FOR SELECT
TO authenticated
USING (true);

-- 3. UPDATEポリシー: すべての認証済みユーザーが組織を更新可能
-- （後で管理者のみに制限可能）
CREATE POLICY "update_organization"
ON organizations
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 4. DELETEポリシー: すべての認証済みユーザーが組織を削除可能
-- （後で管理者のみに制限可能）
CREATE POLICY "delete_organization"
ON organizations
FOR DELETE
TO authenticated
USING (true);

-- RLSを有効化
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- 確認: ポリシー一覧を表示
SELECT
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename = 'organizations'
ORDER BY cmd, policyname;
