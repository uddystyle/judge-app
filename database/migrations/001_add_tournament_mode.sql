-- ============================================================
-- Migration: Add Tournament Mode Support
-- Description: Adds tournament mode features including custom events,
--              participants, and new scoring methods (3-3, 5-3)
-- Date: 2025-10-25
-- ============================================================

-- ============================================================
-- 1. Extend sessions table for tournament mode
-- ============================================================

-- Add tournament mode flag
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS is_tournament_mode boolean DEFAULT false;

-- Add scoring calculation method
-- 'average': 平均点方式（検定モード）
-- 'sum': 合計点方式（大会モード）
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS score_calculation text DEFAULT 'average';

-- Add flag to exclude extremes (for 5審3採)
-- true: 最大・最小を除外（5審3採）
-- false: 全員の点数を使用（3審3採）
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS exclude_extremes boolean DEFAULT false;

-- Add constraint to validate score_calculation values
ALTER TABLE sessions
  ADD CONSTRAINT valid_score_calculation
  CHECK (score_calculation IN ('average', 'sum'));

-- ============================================================
-- 2. Create custom_events table
-- ============================================================

CREATE TABLE IF NOT EXISTS custom_events (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  discipline text NOT NULL,
  level text NOT NULL,
  event_name text NOT NULL,
  display_order int DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_custom_events_session_id
  ON custom_events(session_id);

CREATE INDEX IF NOT EXISTS idx_custom_events_lookup
  ON custom_events(session_id, discipline, level);

-- ============================================================
-- 3. Create participants table
-- ============================================================

CREATE TABLE IF NOT EXISTS participants (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  bib_number int NOT NULL,
  athlete_name text NOT NULL,
  team_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT unique_bib_per_session UNIQUE(session_id, bib_number)
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_participants_session_id
  ON participants(session_id);

CREATE INDEX IF NOT EXISTS idx_participants_bib
  ON participants(session_id, bib_number);

-- ============================================================
-- 4. Enable Row Level Security (RLS)
-- ============================================================

ALTER TABLE custom_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. RLS Policies for custom_events
-- ============================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view custom events for their sessions" ON custom_events;
DROP POLICY IF EXISTS "Session participants can view custom events" ON custom_events;
DROP POLICY IF EXISTS "Session creators can manage custom events" ON custom_events;

-- Users can view custom events for sessions they participate in
CREATE POLICY "Session participants can view custom events"
  ON custom_events
  FOR SELECT
  USING (
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  );

-- Session creators and chief judges can insert custom events
CREATE POLICY "Session creators can insert custom events"
  ON custom_events
  FOR INSERT
  WITH CHECK (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
         OR chief_judge_id = auth.uid()
    )
  );

-- Session creators and chief judges can update custom events
CREATE POLICY "Session creators can update custom events"
  ON custom_events
  FOR UPDATE
  USING (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
         OR chief_judge_id = auth.uid()
    )
  );

-- Session creators and chief judges can delete custom events
CREATE POLICY "Session creators can delete custom events"
  ON custom_events
  FOR DELETE
  USING (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
         OR chief_judge_id = auth.uid()
    )
  );

-- ============================================================
-- 6. RLS Policies for participants
-- ============================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view participants for their sessions" ON participants;
DROP POLICY IF EXISTS "Session participants can view participants" ON participants;
DROP POLICY IF EXISTS "Session creators can manage participants" ON participants;
DROP POLICY IF EXISTS "Public can view participants" ON participants;

-- Session participants can view participants (for scoreboard)
CREATE POLICY "Session participants can view participants"
  ON participants
  FOR SELECT
  USING (
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  );

-- Session creators and chief judges can insert participants
CREATE POLICY "Session creators can insert participants"
  ON participants
  FOR INSERT
  WITH CHECK (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
         OR chief_judge_id = auth.uid()
    )
  );

-- Session creators and chief judges can update participants
CREATE POLICY "Session creators can update participants"
  ON participants
  FOR UPDATE
  USING (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
         OR chief_judge_id = auth.uid()
    )
  );

-- Session creators and chief judges can delete participants
CREATE POLICY "Session creators can delete participants"
  ON participants
  FOR DELETE
  USING (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
         OR chief_judge_id = auth.uid()
    )
  );

-- ============================================================
-- 7. Create function to update updated_at timestamp
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- ============================================================
-- 8. Create triggers for updated_at
-- ============================================================

DROP TRIGGER IF EXISTS update_custom_events_updated_at ON custom_events;
CREATE TRIGGER update_custom_events_updated_at
  BEFORE UPDATE ON custom_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_participants_updated_at ON participants;
CREATE TRIGGER update_participants_updated_at
  BEFORE UPDATE ON participants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 9. Add comments for documentation
-- ============================================================

COMMENT ON COLUMN sessions.is_tournament_mode IS '大会モードフラグ。trueの場合はカスタム種目と採点方式を使用';
COMMENT ON COLUMN sessions.score_calculation IS '得点計算方法: average=平均点, sum=合計点';
COMMENT ON COLUMN sessions.exclude_extremes IS '最大・最小を除外するか（5審3採用）';

COMMENT ON TABLE custom_events IS '大会モード用のカスタム種目テーブル';
COMMENT ON TABLE participants IS '大会参加者情報（エクスポート用、個人情報保護のためスコアボードには表示しない）';

-- ============================================================
-- Migration complete
-- ============================================================
