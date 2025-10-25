-- ============================================================
-- Migration: Add Notification Cleanup
-- Description: Automatically delete old notifications to prevent
--              table bloat. Keeps only the latest 10 notifications
--              per session.
-- Date: 2025-10-26
-- ============================================================

-- ============================================================
-- 1. Create cleanup function
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS TRIGGER AS $$
BEGIN
  -- 1時間以上前の古い通知を削除
  DELETE FROM session_notifications
  WHERE session_id = NEW.session_id
  AND created_at < NOW() - INTERVAL '1 hour';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. Create trigger to run cleanup after insert
-- ============================================================

DROP TRIGGER IF EXISTS trigger_cleanup_old_notifications ON session_notifications;

CREATE TRIGGER trigger_cleanup_old_notifications
  AFTER INSERT ON session_notifications
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_old_notifications();

-- ============================================================
-- 3. Add comment for documentation
-- ============================================================

COMMENT ON FUNCTION cleanup_old_notifications() IS '新しい通知が挿入されたときに、1時間以上前の古い通知を自動削除';

-- ============================================================
-- Migration complete
-- ============================================================
