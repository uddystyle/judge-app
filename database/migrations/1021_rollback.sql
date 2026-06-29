-- ============================================================================
-- ROLLBACK for 1021_sessions_dedupe_own_policies.sql
-- ============================================================================
-- 撤去した public ロールの own 重複2本を復帰（緊急時のみ）。冪等。
-- ※ authed 版が own 付与を担保しているため通常は不要。
-- ============================================================================

drop policy if exists "Users can delete their own sessions." on public.sessions;
create policy "Users can delete their own sessions."
  on public.sessions for delete to public
  using (auth.uid() = created_by);

drop policy if exists "Users can update their own sessions." on public.sessions;
create policy "Users can update their own sessions."
  on public.sessions for update to public
  using (auth.uid() = created_by);
