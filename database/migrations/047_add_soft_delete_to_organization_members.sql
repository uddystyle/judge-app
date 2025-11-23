-- 047_add_soft_delete_to_organization_members.sql
-- 組織メンバーのSoft Delete（論理削除）機能を追加

-- 1. organization_members テーブルにカラム追加
ALTER TABLE organization_members
ADD COLUMN removed_at TIMESTAMPTZ NULL,
ADD COLUMN removed_by UUID REFERENCES auth.users(id);

-- 2. コメント追加
COMMENT ON COLUMN organization_members.removed_at IS
'組織から削除された日時。NULLの場合はアクティブなメンバー。';

COMMENT ON COLUMN organization_members.removed_by IS
'削除を実行したユーザーのID。';

-- 3. インデックス追加（パフォーマンス向上）
CREATE INDEX idx_organization_members_removed_at
ON organization_members(removed_at)
WHERE removed_at IS NULL;

COMMENT ON INDEX idx_organization_members_removed_at IS
'アクティブなメンバー（removed_at IS NULL）のクエリを高速化するための部分インデックス。';

-- 4. 既存のRLSポリシーを更新
-- 既存の "Members can view organization members" ポリシーを削除して再作成
DROP POLICY IF EXISTS "Members can view organization members" ON organization_members;

CREATE POLICY "Members can view active organization members"
ON organization_members FOR SELECT
TO authenticated
USING (
  removed_at IS NULL AND
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND removed_at IS NULL
  )
);

COMMENT ON POLICY "Members can view active organization members" ON organization_members IS
'アクティブなメンバー（削除されていない）のみが、同じ組織のアクティブなメンバーを閲覧できる。';

-- 5. 管理者がアーカイブ（削除されたメンバー）を閲覧できるポリシーを追加
CREATE POLICY "Admins can view removed members"
ON organization_members FOR SELECT
TO authenticated
USING (
  removed_at IS NOT NULL AND
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
    AND removed_at IS NULL
  )
);

COMMENT ON POLICY "Admins can view removed members" ON organization_members IS
'管理者は削除されたメンバーも閲覧できる（将来のアーカイブ機能用）。';

-- 6. メンバー削除（更新）のポリシー追加
CREATE POLICY "Admins can remove members"
ON organization_members FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
    AND removed_at IS NULL
  )
  AND removed_at IS NULL  -- アクティブなメンバーのみ削除可能
)
WITH CHECK (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
    AND removed_at IS NULL
  )
);

COMMENT ON POLICY "Admins can remove members" ON organization_members IS
'管理者のみがメンバーを削除（removed_atを更新）できる。';

-- 7. 検証用クエリ
-- このマイグレーション後に実行して確認できる
DO $$
BEGIN
  -- カラムが追加されたことを確認
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organization_members'
    AND column_name = 'removed_at'
  ) THEN
    RAISE NOTICE 'SUCCESS: removed_at column added to organization_members';
  ELSE
    RAISE EXCEPTION 'FAILED: removed_at column not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organization_members'
    AND column_name = 'removed_by'
  ) THEN
    RAISE NOTICE 'SUCCESS: removed_by column added to organization_members';
  ELSE
    RAISE EXCEPTION 'FAILED: removed_by column not found';
  END IF;

  -- インデックスが作成されたことを確認
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'organization_members'
    AND indexname = 'idx_organization_members_removed_at'
  ) THEN
    RAISE NOTICE 'SUCCESS: idx_organization_members_removed_at index created';
  ELSE
    RAISE EXCEPTION 'FAILED: idx_organization_members_removed_at index not found';
  END IF;

  RAISE NOTICE 'Migration 047 completed successfully';
END $$;
