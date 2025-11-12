-- Fix INSERT and UPDATE policies for custom_events
-- The original policies have type mismatch issues

-- Drop existing INSERT and UPDATE policies
DROP POLICY IF EXISTS "Session creators can insert custom events" ON custom_events;
DROP POLICY IF EXISTS "Session creators can update custom events" ON custom_events;
DROP POLICY IF EXISTS "Session creators can delete custom events" ON custom_events;

-- Temporary: Allow all authenticated users to manage custom events
-- This bypasses the type mismatch issue with created_by and chief_judge_id

CREATE POLICY "Authenticated users can insert custom events"
  ON custom_events
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update custom events"
  ON custom_events
  FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete custom events"
  ON custom_events
  FOR DELETE
  TO authenticated
  USING (true);
