-- ============================================================
-- Migration: Add Session Notifications
-- Description: Adds a notifications table for reliable real-time
--              communication between chief judge and general judges
-- Date: 2025-10-26
-- ============================================================

-- ============================================================
-- 1. Create session_notifications table
-- ============================================================

CREATE TABLE IF NOT EXISTS session_notifications (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Add constraint to validate notification_type values
ALTER TABLE session_notifications
  ADD CONSTRAINT valid_notification_type
  CHECK (notification_type IN ('session_ended', 'session_restarted'));

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_session_notifications_session_id
  ON session_notifications(session_id);

CREATE INDEX IF NOT EXISTS idx_session_notifications_created_at
  ON session_notifications(created_at DESC);

-- ============================================================
-- 2. Enable Row Level Security (RLS)
-- ============================================================

ALTER TABLE session_notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. RLS Policies for session_notifications
-- ============================================================

-- Session participants can view notifications
CREATE POLICY "Session participants can view notifications"
  ON session_notifications
  FOR SELECT
  USING (
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  );

-- Chief judges can insert notifications
CREATE POLICY "Chief judges can insert notifications"
  ON session_notifications
  FOR INSERT
  WITH CHECK (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE chief_judge_id = auth.uid()
    )
  );

-- ============================================================
-- 4. Add comments for documentation
-- ============================================================

COMMENT ON TABLE session_notifications IS 'セッション通知テーブル（主任検定員から一般検定員への確実な通知用）';
COMMENT ON COLUMN session_notifications.notification_type IS '通知タイプ: session_ended=検定終了, session_restarted=検定再開';

-- ============================================================
-- Migration complete
-- ============================================================
