-- 048_add_soft_delete_to_sessions.sql
-- セッションのSoft Delete（論理削除）機能を追加

-- 1. sessions テーブルにカラム追加
ALTER TABLE sessions
ADD COLUMN deleted_at TIMESTAMPTZ NULL,
ADD COLUMN deleted_by UUID REFERENCES auth.users(id);

-- 2. コメント追加
COMMENT ON COLUMN sessions.deleted_at IS
'セッションが削除された日時。NULLの場合はアクティブなセッション。';

COMMENT ON COLUMN sessions.deleted_by IS
'削除を実行したユーザーのID。';

-- 3. インデックス追加（パフォーマンス向上）
CREATE INDEX idx_sessions_deleted_at
ON sessions(deleted_at)
WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_sessions_deleted_at IS
'アクティブなセッション（deleted_at IS NULL）のクエリを高速化するための部分インデックス。';

-- 4. 既存のRLSポリシーを更新
-- 既存の "Users can view sessions they have access to" ポリシーを削除して再作成
DROP POLICY IF EXISTS "Users can view sessions they have access to" ON sessions;

CREATE POLICY "Users can view active sessions they have access to"
ON sessions FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL AND
  (
    -- 組織のメンバーはそのセッションにアクセス可能
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
      AND removed_at IS NULL
    )
    OR
    -- セッションの参加者もアクセス可能
    id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  )
);

COMMENT ON POLICY "Users can view active sessions they have access to" ON sessions IS
'ユーザーは、所属する組織のアクティブなセッションまたは参加しているアクティブなセッションを閲覧できる。';

-- 5. 管理者がアーカイブ（削除されたセッション）を閲覧できるポリシーを追加
CREATE POLICY "Admins can view deleted sessions"
ON sessions FOR SELECT
TO authenticated
USING (
  deleted_at IS NOT NULL AND
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
    AND removed_at IS NULL
  )
);

COMMENT ON POLICY "Admins can view deleted sessions" ON sessions IS
'管理者は削除されたセッションも閲覧できる（将来のアーカイブ機能用）。';

-- 6. セッション削除（更新）のポリシー追加
CREATE POLICY "Admins can delete sessions"
ON sessions FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
    AND role = 'admin'
    AND removed_at IS NULL
  )
  AND deleted_at IS NULL  -- アクティブなセッションのみ削除可能
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

COMMENT ON POLICY "Admins can delete sessions" ON sessions IS
'管理者のみがセッションを削除（deleted_atを更新）できる。';

-- 7. 検証用クエリ
DO $$
BEGIN
  -- カラムが追加されたことを確認
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sessions'
    AND column_name = 'deleted_at'
  ) THEN
    RAISE NOTICE 'SUCCESS: deleted_at column added to sessions';
  ELSE
    RAISE EXCEPTION 'FAILED: deleted_at column not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sessions'
    AND column_name = 'deleted_by'
  ) THEN
    RAISE NOTICE 'SUCCESS: deleted_by column added to sessions';
  ELSE
    RAISE EXCEPTION 'FAILED: deleted_by column not found';
  END IF;

  -- インデックスが作成されたことを確認
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'sessions'
    AND indexname = 'idx_sessions_deleted_at'
  ) THEN
    RAISE NOTICE 'SUCCESS: idx_sessions_deleted_at index created';
  ELSE
    RAISE EXCEPTION 'FAILED: idx_sessions_deleted_at index not found';
  END IF;

  RAISE NOTICE 'Migration 048 completed successfully';
END $$;
