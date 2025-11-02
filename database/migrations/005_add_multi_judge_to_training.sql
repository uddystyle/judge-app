-- ============================================================
-- Migration: Add Multi-Judge Mode to Training Sessions
-- Description: Adds is_multi_judge flag to training_sessions table
-- Date: 2025-11-01
-- ============================================================

-- Add is_multi_judge column to training_sessions
ALTER TABLE training_sessions
  ADD COLUMN IF NOT EXISTS is_multi_judge boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN training_sessions.is_multi_judge IS '複数検定員モード: true=主任が採点指示, false=各自が自由に採点';

-- ============================================================
-- Migration complete
-- ============================================================
