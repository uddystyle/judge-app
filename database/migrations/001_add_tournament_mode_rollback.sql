-- ============================================================
-- Rollback Migration: Add Tournament Mode Support
-- Description: Rolls back tournament mode features
-- Date: 2025-10-25
-- ============================================================

-- ============================================================
-- WARNING: This will delete all custom events and participants data!
-- ============================================================

-- 1. Drop triggers
DROP TRIGGER IF EXISTS update_custom_events_updated_at ON custom_events;
DROP TRIGGER IF EXISTS update_participants_updated_at ON participants;

-- 2. Drop function
DROP FUNCTION IF EXISTS update_updated_at_column();

-- 3. Drop tables (CASCADE will remove all data and dependent objects)
DROP TABLE IF EXISTS participants CASCADE;
DROP TABLE IF EXISTS custom_events CASCADE;

-- 4. Remove columns from sessions table
ALTER TABLE sessions DROP COLUMN IF EXISTS is_tournament_mode;
ALTER TABLE sessions DROP COLUMN IF EXISTS score_calculation;
ALTER TABLE sessions DROP COLUMN IF EXISTS exclude_extremes;

-- 5. Drop constraint
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS valid_score_calculation;

-- ============================================================
-- Rollback complete
-- ============================================================
