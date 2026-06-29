-- ============================================================
-- Rollback Migration: Add Training Mode Support
-- Description: Rolls back training mode features
-- Date: 2025-11-01
-- ============================================================

-- ============================================================
-- WARNING: This will delete all training mode data!
-- ============================================================

-- 1. Drop triggers
DROP TRIGGER IF EXISTS update_training_sessions_updated_at ON training_sessions;
DROP TRIGGER IF EXISTS update_training_events_updated_at ON training_events;
DROP TRIGGER IF EXISTS update_training_scores_updated_at ON training_scores;

-- 2. Drop tables (CASCADE will remove all data and dependent objects)
DROP TABLE IF EXISTS training_scores CASCADE;
DROP TABLE IF EXISTS training_events CASCADE;
DROP TABLE IF EXISTS training_sessions CASCADE;

-- 3. Drop index from sessions table
DROP INDEX IF EXISTS idx_sessions_mode;

-- 4. Remove mode column from sessions table
ALTER TABLE sessions DROP COLUMN IF EXISTS mode;

-- 5. Drop constraint
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS valid_session_mode;

-- ============================================================
-- Rollback complete
-- ============================================================
