-- Migration: Remove Duplicate Indexes
-- Purpose: Remove duplicate indexes identified by Supabase Performance Advisor
-- Impact: Reduces storage usage and improves write performance
-- Risk: Low (only removes exact duplicates)
-- Date: 2025-11-30

-- ============================================================
-- DUPLICATE INDEX REMOVAL
-- ============================================================

-- Contact Submissions Table (3 duplicates)
-- Note: Keep the most descriptive index name, drop duplicates
DROP INDEX IF EXISTS idx_contact_submissions_email;
DROP INDEX IF EXISTS idx_contact_submissions_created_at;
DROP INDEX IF EXISTS contact_submissions_email_idx;

-- Organization Members Table (1 duplicate)
DROP INDEX IF EXISTS idx_organization_members_org_id;

-- Participants Table (1 duplicate)
DROP INDEX IF EXISTS idx_participants_session_id;

-- Sessions Table (2 duplicates)
DROP INDEX IF EXISTS idx_sessions_created_by;
DROP INDEX IF EXISTS idx_sessions_organization_id;

-- Training Events Table (1 duplicate)
DROP INDEX IF EXISTS idx_training_events_session_id;

-- Training Scores Table (1 duplicate)
DROP INDEX IF EXISTS idx_training_scores_session_id;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- Run these queries after migration to verify duplicate indexes are removed

-- Check for remaining indexes on each table:
-- SELECT tablename, indexname, indexdef FROM pg_indexes WHERE tablename = 'contact_submissions' ORDER BY indexname;
-- SELECT tablename, indexname, indexdef FROM pg_indexes WHERE tablename = 'organization_members' ORDER BY indexname;
-- SELECT tablename, indexname, indexdef FROM pg_indexes WHERE tablename = 'participants' ORDER BY indexname;
-- SELECT tablename, indexname, indexdef FROM pg_indexes WHERE tablename = 'sessions' ORDER BY indexname;
-- SELECT tablename, indexname, indexdef FROM pg_indexes WHERE tablename = 'training_events' ORDER BY indexname;
-- SELECT tablename, indexname, indexdef FROM pg_indexes WHERE tablename = 'training_scores' ORDER BY indexname;

-- ============================================================
-- ROLLBACK (if needed)
-- ============================================================
-- If you need to restore any indexes, use CREATE INDEX statements based on the original indexdef
-- Example:
-- CREATE INDEX idx_contact_submissions_email ON contact_submissions(email);
