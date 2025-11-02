-- ============================================================
-- Migration: Add Training Mode Support
-- Description: Adds training mode features for judge training sessions
--              with up to 100 judges, individual score display (no aggregation),
--              and flexible event configuration.
-- Date: 2025-11-01
-- ============================================================

-- ============================================================
-- 1. Extend sessions table with mode column
-- ============================================================

-- Add mode column to differentiate between certification, tournament, and training modes
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS mode text DEFAULT 'certification';

-- Add constraint to validate mode values (drop first if exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'valid_session_mode'
    AND table_name = 'sessions'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT valid_session_mode
      CHECK (mode IN ('certification', 'tournament', 'training'));
  END IF;
END $$;

-- Update existing sessions based on is_tournament_mode flag
UPDATE sessions
SET mode = CASE
  WHEN is_tournament_mode = true THEN 'tournament'
  ELSE 'certification'
END
WHERE mode = 'certification';

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_sessions_mode ON sessions(mode);

-- ============================================================
-- 2. Create training_sessions table
-- ============================================================

CREATE TABLE IF NOT EXISTS training_sessions (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- Chief judge (主任検定員)
  chief_judge_id bigint REFERENCES participants(id) ON DELETE SET NULL,

  -- Display settings
  show_individual_scores boolean DEFAULT true,
  show_score_comparison boolean DEFAULT true,
  show_deviation_analysis boolean DEFAULT false,

  -- Limits
  max_judges integer DEFAULT 100,

  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),

  CONSTRAINT unique_training_session_per_session UNIQUE(session_id)
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_training_sessions_session_id
  ON training_sessions(session_id);

CREATE INDEX IF NOT EXISTS idx_training_sessions_chief_judge
  ON training_sessions(chief_judge_id);

-- ============================================================
-- 3. Create training_events table
-- ============================================================

CREATE TABLE IF NOT EXISTS training_events (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

  -- Event information
  name text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,

  -- Scoring settings
  min_score numeric DEFAULT 0,
  max_score numeric DEFAULT 100,
  score_precision integer DEFAULT 1, -- Decimal places

  -- Status
  status text DEFAULT 'pending',

  -- Current athlete being scored (for real-time scoring flow)
  current_athlete_id bigint REFERENCES participants(id) ON DELETE SET NULL,

  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),

  CONSTRAINT valid_training_event_status
    CHECK (status IN ('pending', 'in_progress', 'completed'))
);

-- Add indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_training_events_session
  ON training_events(session_id);

CREATE INDEX IF NOT EXISTS idx_training_events_order
  ON training_events(session_id, order_index);

CREATE INDEX IF NOT EXISTS idx_training_events_status
  ON training_events(status);

CREATE INDEX IF NOT EXISTS idx_training_events_current_athlete
  ON training_events(current_athlete_id);

-- ============================================================
-- 4. Create training_scores table
-- ============================================================

CREATE TABLE IF NOT EXISTS training_scores (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES training_events(id) ON DELETE CASCADE,
  judge_id bigint NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  athlete_id bigint NOT NULL REFERENCES participants(id) ON DELETE CASCADE,

  -- Score
  score numeric NOT NULL,
  is_finalized boolean DEFAULT false,

  -- Optional note/memo
  note text,

  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),

  CONSTRAINT unique_training_score_per_judge_athlete
    UNIQUE(event_id, judge_id, athlete_id)
);

-- Add indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_training_scores_event
  ON training_scores(event_id);

CREATE INDEX IF NOT EXISTS idx_training_scores_judge
  ON training_scores(judge_id);

CREATE INDEX IF NOT EXISTS idx_training_scores_athlete
  ON training_scores(athlete_id);

CREATE INDEX IF NOT EXISTS idx_training_scores_lookup
  ON training_scores(event_id, judge_id, athlete_id);

-- ============================================================
-- 5. Enable Row Level Security (RLS)
-- ============================================================

ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_scores ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. RLS Policies for training_sessions
-- ============================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Session participants can view training sessions" ON training_sessions;
DROP POLICY IF EXISTS "Session creators can insert training sessions" ON training_sessions;
DROP POLICY IF EXISTS "Session creators can update training sessions" ON training_sessions;
DROP POLICY IF EXISTS "Session creators can delete training sessions" ON training_sessions;
DROP POLICY IF EXISTS "Session creators can manage training sessions" ON training_sessions;

-- Session participants can view training sessions
CREATE POLICY "Session participants can view training sessions"
  ON training_sessions
  FOR SELECT
  USING (
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  );

-- Session creators can insert training sessions
CREATE POLICY "Session creators can insert training sessions"
  ON training_sessions
  FOR INSERT
  WITH CHECK (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
    )
  );

-- Session creators and chief judges can update training sessions
CREATE POLICY "Session creators can update training sessions"
  ON training_sessions
  FOR UPDATE
  USING (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
    )
    OR
    chief_judge_id IN (
      SELECT p.id
      FROM participants p
      WHERE p.session_id IN (
        SELECT session_id
        FROM session_participants
        WHERE user_id = auth.uid()
      )
    )
  );

-- Session creators can delete training sessions
CREATE POLICY "Session creators can delete training sessions"
  ON training_sessions
  FOR DELETE
  USING (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
    )
  );

-- ============================================================
-- 7. RLS Policies for training_events
-- ============================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Session participants can view training events" ON training_events;
DROP POLICY IF EXISTS "Session creators can insert training events" ON training_events;
DROP POLICY IF EXISTS "Session creators can update training events" ON training_events;
DROP POLICY IF EXISTS "Session creators can delete training events" ON training_events;
DROP POLICY IF EXISTS "Session creators can manage training events" ON training_events;

-- Session participants can view training events
CREATE POLICY "Session participants can view training events"
  ON training_events
  FOR SELECT
  USING (
    session_id IN (
      SELECT session_id
      FROM session_participants
      WHERE user_id = auth.uid()
    )
  );

-- Session creators and chief judges can insert training events
CREATE POLICY "Session creators can insert training events"
  ON training_events
  FOR INSERT
  WITH CHECK (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
    )
    OR
    session_id IN (
      SELECT ts.session_id
      FROM training_sessions ts
      WHERE ts.chief_judge_id IN (
        SELECT p.id
        FROM participants p
        WHERE p.session_id IN (
          SELECT session_id
          FROM session_participants
          WHERE user_id = auth.uid()
        )
      )
    )
  );

-- Session creators and chief judges can update training events
CREATE POLICY "Session creators can update training events"
  ON training_events
  FOR UPDATE
  USING (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
    )
    OR
    session_id IN (
      SELECT ts.session_id
      FROM training_sessions ts
      WHERE ts.chief_judge_id IN (
        SELECT p.id
        FROM participants p
        WHERE p.session_id IN (
          SELECT session_id
          FROM session_participants
          WHERE user_id = auth.uid()
        )
      )
    )
  );

-- Session creators and chief judges can delete training events
CREATE POLICY "Session creators can delete training events"
  ON training_events
  FOR DELETE
  USING (
    session_id IN (
      SELECT id
      FROM sessions
      WHERE created_by = auth.uid()
    )
    OR
    session_id IN (
      SELECT ts.session_id
      FROM training_sessions ts
      WHERE ts.chief_judge_id IN (
        SELECT p.id
        FROM participants p
        WHERE p.session_id IN (
          SELECT session_id
          FROM session_participants
          WHERE user_id = auth.uid()
        )
      )
    )
  );

-- ============================================================
-- 8. RLS Policies for training_scores
-- ============================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Session participants can view training scores" ON training_scores;
DROP POLICY IF EXISTS "Judges can insert own training scores" ON training_scores;
DROP POLICY IF EXISTS "Judges can update own training scores" ON training_scores;
DROP POLICY IF EXISTS "Judges can delete own training scores" ON training_scores;
DROP POLICY IF EXISTS "Judges can view all training scores" ON training_scores;
DROP POLICY IF EXISTS "Judges can manage own training scores" ON training_scores;
DROP POLICY IF EXISTS "Chief judges can view all training scores" ON training_scores;

-- All session participants can view training scores (for scoreboard)
CREATE POLICY "Session participants can view training scores"
  ON training_scores
  FOR SELECT
  USING (
    event_id IN (
      SELECT te.id
      FROM training_events te
      WHERE te.session_id IN (
        SELECT session_id
        FROM session_participants
        WHERE user_id = auth.uid()
      )
    )
  );

-- Judges can insert their own scores
-- Note: In training mode, judges are also participants in the session
CREATE POLICY "Judges can insert own training scores"
  ON training_scores
  FOR INSERT
  WITH CHECK (
    judge_id IN (
      SELECT p.id
      FROM participants p
      WHERE p.session_id IN (
        SELECT session_id
        FROM session_participants
        WHERE user_id = auth.uid()
      )
    )
  );

-- Judges can update their own scores
CREATE POLICY "Judges can update own training scores"
  ON training_scores
  FOR UPDATE
  USING (
    judge_id IN (
      SELECT p.id
      FROM participants p
      WHERE p.session_id IN (
        SELECT session_id
        FROM session_participants
        WHERE user_id = auth.uid()
      )
    )
  );

-- Judges can delete their own scores
CREATE POLICY "Judges can delete own training scores"
  ON training_scores
  FOR DELETE
  USING (
    judge_id IN (
      SELECT p.id
      FROM participants p
      WHERE p.session_id IN (
        SELECT session_id
        FROM session_participants
        WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================================
-- 9. Create triggers for updated_at
-- ============================================================

DROP TRIGGER IF EXISTS update_training_sessions_updated_at ON training_sessions;
CREATE TRIGGER update_training_sessions_updated_at
  BEFORE UPDATE ON training_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_training_events_updated_at ON training_events;
CREATE TRIGGER update_training_events_updated_at
  BEFORE UPDATE ON training_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_training_scores_updated_at ON training_scores;
CREATE TRIGGER update_training_scores_updated_at
  BEFORE UPDATE ON training_scores
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 10. Add comments for documentation
-- ============================================================

COMMENT ON COLUMN sessions.mode IS 'セッションモード: certification=検定, tournament=大会, training=研修';

COMMENT ON TABLE training_sessions IS '研修モード設定テーブル。主任検定員や表示設定を管理';
COMMENT ON COLUMN training_sessions.chief_judge_id IS '主任検定員のparticipants.id';
COMMENT ON COLUMN training_sessions.show_individual_scores IS '個別採点の表示フラグ';
COMMENT ON COLUMN training_sessions.show_score_comparison IS '採点比較の表示フラグ';
COMMENT ON COLUMN training_sessions.show_deviation_analysis IS '標準偏差分析の表示フラグ';
COMMENT ON COLUMN training_sessions.max_judges IS '最大検定員数（デフォルト100名）';

COMMENT ON TABLE training_events IS '研修モード用種目テーブル';
COMMENT ON COLUMN training_events.name IS '種目名（自由入力）';
COMMENT ON COLUMN training_events.order_index IS '種目の表示順序';
COMMENT ON COLUMN training_events.min_score IS '最小点数';
COMMENT ON COLUMN training_events.max_score IS '最大点数';
COMMENT ON COLUMN training_events.score_precision IS '小数点以下の桁数';
COMMENT ON COLUMN training_events.status IS '種目のステータス: pending, in_progress, completed';
COMMENT ON COLUMN training_events.current_athlete_id IS '現在採点中の選手ID（リアルタイム採点用）';

COMMENT ON TABLE training_scores IS '研修モードの採点データ（個別表示用、集計なし）';
COMMENT ON COLUMN training_scores.score IS '採点（数値）';
COMMENT ON COLUMN training_scores.is_finalized IS '採点確定フラグ';
COMMENT ON COLUMN training_scores.note IS '採点メモ（オプション）';

-- ============================================================
-- Migration complete
-- ============================================================
