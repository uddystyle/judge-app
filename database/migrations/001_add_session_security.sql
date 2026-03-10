-- 001_add_session_security.sql
-- セッションのセキュリティ強化のための列を追加

-- failed_join_attempts: 参加コードの失敗試行回数を追跡
-- is_locked: 不正アクセス検出後のセッションロック状態
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS failed_join_attempts INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false NOT NULL;

-- ロックされていないセッションの参加コード検索を高速化するインデックス
CREATE INDEX IF NOT EXISTS idx_sessions_join_code_active
ON sessions(join_code)
WHERE is_locked = false AND deleted_at IS NULL;

-- コメント追加
COMMENT ON COLUMN sessions.failed_join_attempts IS '参加コードの失敗試行回数（10回で自動ロック）';
COMMENT ON COLUMN sessions.is_locked IS 'セッションがロックされているか（true = ロック中、参加不可）';
