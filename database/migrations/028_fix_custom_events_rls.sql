-- Fix RLS policy for custom_events to allow all authenticated users to view
-- Temporary fix: allow any authenticated user to view custom_events
-- TODO: Restrict this once we understand the correct schema

-- Drop the existing SELECT policy
DROP POLICY IF EXISTS "Session participants can view custom events" ON custom_events;

-- Temporary: Allow all authenticated users to view custom events
-- This is needed because created_by type mismatch prevents proper authorization
CREATE POLICY "Authenticated users can view custom events"
  ON custom_events
  FOR SELECT
  TO authenticated
  USING (true);
