-- ============================================================
-- Migration: Fix training_scores judge_id to reference users directly
-- Description: Change judge_id from participants.id to auth.users UUID
-- Date: 2025-11-01
-- ============================================================

-- Drop existing training_scores table and recreate with correct structure
DROP TABLE IF EXISTS training_scores CASCADE;

CREATE TABLE training_scores (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES training_events(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id bigint NOT NULL REFERENCES participants(id) ON DELETE CASCADE,

  -- Score
  score numeric NOT NULL,
  is_finalized boolean DEFAULT false,

  -- Optional note/memo
  note text,

  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),

  -- Ensure one score per judge per athlete per event
  CONSTRAINT unique_training_score UNIQUE(event_id, judge_id, athlete_id)
);

-- Add indexes for performance
CREATE INDEX idx_training_scores_event ON training_scores(event_id);
CREATE INDEX idx_training_scores_judge ON training_scores(judge_id);
CREATE INDEX idx_training_scores_athlete ON training_scores(athlete_id);
CREATE INDEX idx_training_scores_finalized ON training_scores(is_finalized);

-- Enable RLS
ALTER TABLE training_scores ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Judges can insert their own scores" ON training_scores;
DROP POLICY IF EXISTS "Judges can view their own scores" ON training_scores;
DROP POLICY IF EXISTS "Judges can update their own scores" ON training_scores;
DROP POLICY IF EXISTS "Session participants can view all scores" ON training_scores;

-- Judges can insert their own scores
CREATE POLICY "Judges can insert their own scores"
  ON training_scores
  FOR INSERT
  WITH CHECK (
    judge_id = auth.uid()
    AND event_id IN (
      SELECT te.id
      FROM training_events te
      JOIN sessions s ON te.session_id = s.id
      WHERE s.id IN (
        SELECT session_id
        FROM session_participants
        WHERE user_id = auth.uid()
      )
    )
  );

-- Judges can view their own scores
CREATE POLICY "Judges can view their own scores"
  ON training_scores
  FOR SELECT
  USING (
    judge_id = auth.uid()
    OR event_id IN (
      SELECT te.id
      FROM training_events te
      JOIN sessions s ON te.session_id = s.id
      WHERE s.created_by = auth.uid()
      OR s.id IN (
        SELECT session_id
        FROM session_participants
        WHERE user_id = auth.uid()
      )
    )
  );

-- Judges can update their own scores
CREATE POLICY "Judges can update their own scores"
  ON training_scores
  FOR UPDATE
  USING (judge_id = auth.uid())
  WITH CHECK (judge_id = auth.uid());

-- ============================================================
-- Migration complete
-- ============================================================
