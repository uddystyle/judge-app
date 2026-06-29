-- ============================================================================
-- Migration: Add judge_id column to results table
-- Description: 完全な所有権チェックのため judge_id (UUID) カラムを追加
-- Priority: SECURITY ENHANCEMENT
-- Date: 2026-03-11
-- Status: PLANNED (Not yet implemented)
-- ============================================================================
-- ⚠️ WARNING: This is a BREAKING CHANGE migration
-- This migration adds judge_id column to results table and migrates existing data.
-- Requires careful planning and testing before deployment.
--
-- Prerequisites:
-- 1. Migration 1000 (secure guest session isolation) must be applied first
-- 2. Application code must be updated to use judge_id instead of judge_name
-- 3. Backup all results data before running this migration
--
-- Migration steps:
-- 1. Add judge_id column (nullable)
-- 2. Backfill existing data: map judge_name to user_id via profiles
-- 3. Update RLS policies to use judge_id = auth.uid()
-- 4. Update application code to set judge_id on INSERT
-- 5. (Future) Make judge_id NOT NULL after all data is migrated
-- ============================================================================

-- ⚠️ THIS MIGRATION IS NOT YET READY FOR PRODUCTION
-- Please review and test thoroughly before applying.

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 1001: Add judge_id to results (PLANNED)';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️ THIS MIGRATION IS NOT YET IMPLEMENTED';
  RAISE NOTICE 'This is a placeholder for future implementation.';
  RAISE NOTICE '';
  RAISE NOTICE 'When implemented, this migration will:';
  RAISE NOTICE '1. Add judge_id UUID column to results table';
  RAISE NOTICE '2. Backfill existing data using judge_name → profiles.full_name mapping';
  RAISE NOTICE '3. Update RLS policies to use judge_id = auth.uid()';
  RAISE NOTICE '4. Eliminate same-name collision risk completely';
  RAISE NOTICE '';
  RAISE NOTICE 'Current workaround (Migration 1000):';
  RAISE NOTICE '- Uses session_participants check + judge_name';
  RAISE NOTICE '- Limits collision risk to same-session only (acceptable)';
  RAISE NOTICE '=================================================================';
END $$;

-- ============================================================================
-- Step 1: Add judge_id column (nullable initially)
-- ============================================================================
-- ⚠️ COMMENTED OUT - Not yet ready for production

-- DO $$
-- BEGIN
--   RAISE NOTICE '';
--   RAISE NOTICE 'Step 1: Adding judge_id column...';
--   RAISE NOTICE '--------------------------------------------------------';
-- END $$;
--
-- ALTER TABLE results
-- ADD COLUMN IF NOT EXISTS judge_id UUID REFERENCES auth.users(id);
--
-- CREATE INDEX IF NOT EXISTS idx_results_judge_id ON results(judge_id);
--
-- DO $$
-- BEGIN
--   RAISE NOTICE '✓ Added judge_id column (nullable)';
--   RAISE NOTICE '✓ Created index on judge_id';
-- END $$;

-- ============================================================================
-- Step 2: Backfill existing data
-- ============================================================================
-- ⚠️ COMMENTED OUT - Requires careful data mapping

-- DO $$
-- BEGIN
--   RAISE NOTICE '';
--   RAISE NOTICE 'Step 2: Backfilling existing data...';
--   RAISE NOTICE '--------------------------------------------------------';
-- END $$;
--
-- -- Map judge_name to user_id via profiles.full_name
-- -- ⚠️ WARNING: This may fail for duplicate full_names
-- UPDATE results r
-- SET judge_id = (
--   SELECT p.id
--   FROM profiles p
--   WHERE p.full_name = r.judge_name
--   LIMIT 1  -- ⚠️ Ambiguous if multiple users have same name
-- )
-- WHERE r.judge_id IS NULL
--   AND r.judge_name IS NOT NULL;
--
-- DO $$
-- DECLARE
--   updated_count INT;
--   null_count INT;
-- BEGIN
--   SELECT COUNT(*) INTO updated_count FROM results WHERE judge_id IS NOT NULL;
--   SELECT COUNT(*) INTO null_count FROM results WHERE judge_id IS NULL AND judge_name IS NOT NULL;
--
--   RAISE NOTICE '✓ Backfilled % results with judge_id', updated_count;
--   IF null_count > 0 THEN
--     RAISE WARNING '⚠️ % results could not be mapped (no matching profile)', null_count;
--   END IF;
-- END $$;

-- ============================================================================
-- Step 3: Update RLS policies
-- ============================================================================
-- ⚠️ COMMENTED OUT - Application code must be updated first

-- DO $$
-- BEGIN
--   RAISE NOTICE '';
--   RAISE NOTICE 'Step 3: Updating RLS policies...';
--   RAISE NOTICE '--------------------------------------------------------';
-- END $$;
--
-- -- Drop old policies
-- DROP POLICY IF EXISTS "Authenticated users can update their own results" ON results;
--
-- -- Create new policy using judge_id
-- CREATE POLICY "Authenticated users can update their own results"
--   ON results FOR UPDATE
--   TO authenticated
--   USING (
--     -- ✅ Perfect ownership check: judge_id = auth.uid()
--     judge_id = auth.uid()
--     -- ✅ Session participation check (defense in depth)
--     AND session_id IN (
--       SELECT session_id
--       FROM session_participants
--       WHERE user_id = auth.uid()
--     )
--   )
--   WITH CHECK (
--     judge_id = auth.uid()
--     AND session_id IN (
--       SELECT session_id
--       FROM session_participants
--       WHERE user_id = auth.uid()
--     )
--   );
--
-- DO $$
-- BEGIN
--   RAISE NOTICE '✓ Updated RLS policies to use judge_id';
--   RAISE NOTICE '  Security improvement: Eliminates same-name collision risk';
-- END $$;

-- ============================================================================
-- Step 4: Application code updates required
-- ============================================================================
-- ⚠️ CRITICAL: Application code must be updated before making judge_id NOT NULL

-- DO $$
-- BEGIN
--   RAISE NOTICE '';
--   RAISE NOTICE 'Step 4: Application code updates required';
--   RAISE NOTICE '--------------------------------------------------------';
--   RAISE NOTICE 'Before making judge_id NOT NULL, update application code to:';
--   RAISE NOTICE '1. Set judge_id on INSERT (currently only sets judge_name)';
--   RAISE NOTICE '2. Update query filters to use judge_id instead of judge_name';
--   RAISE NOTICE '3. Test thoroughly in staging environment';
--   RAISE NOTICE '';
--   RAISE NOTICE 'Example code change:';
--   RAISE NOTICE '  // Before';
--   RAISE NOTICE '  { judge_name: user.full_name }';
--   RAISE NOTICE '';
--   RAISE NOTICE '  // After';
--   RAISE NOTICE '  { judge_id: user.id, judge_name: user.full_name }';
-- END $$;

-- ============================================================================
-- Step 5: Make judge_id NOT NULL (Future)
-- ============================================================================
-- ⚠️ COMMENTED OUT - Only after all data is migrated and application is updated

-- DO $$
-- BEGIN
--   RAISE NOTICE '';
--   RAISE NOTICE 'Step 5: Making judge_id NOT NULL...';
--   RAISE NOTICE '--------------------------------------------------------';
-- END $$;
--
-- ALTER TABLE results
-- ALTER COLUMN judge_id SET NOT NULL;
--
-- DO $$
-- BEGIN
--   RAISE NOTICE '✓ Made judge_id NOT NULL';
--   RAISE NOTICE '✅ Migration complete: results table now has mandatory judge_id';
-- END $$;

-- ============================================================================
-- Summary
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 1001 Summary (PLANNED)';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Status: NOT IMPLEMENTED';
  RAISE NOTICE 'This migration is planned for future implementation.';
  RAISE NOTICE '';
  RAISE NOTICE 'Current workaround (Migration 1000):';
  RAISE NOTICE '✅ Adequate security for most use cases';
  RAISE NOTICE '✅ Prevents cross-session attacks';
  RAISE NOTICE '⚠️ Same-name collision risk limited to same-session only';
  RAISE NOTICE '';
  RAISE NOTICE 'Future enhancement (this migration):';
  RAISE NOTICE '✅ Eliminates same-name collision risk completely';
  RAISE NOTICE '✅ Uses judge_id = auth.uid() for perfect ownership check';
  RAISE NOTICE '⚠️ Requires application code updates';
  RAISE NOTICE '⚠️ Requires careful data migration';
  RAISE NOTICE '';
  RAISE NOTICE 'Recommendation:';
  RAISE NOTICE '- Use Migration 1000 for immediate security improvements';
  RAISE NOTICE '- Plan Migration 1001 for future complete fix';
  RAISE NOTICE '- Test thoroughly in staging before production';
  RAISE NOTICE '=================================================================';
END $$;
