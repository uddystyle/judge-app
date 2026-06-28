-- ============================================================================
-- ROLLBACK for 1012_custom_events_rls_lockdown.sql
-- ============================================================================
-- スコープ付きポリシーを撤去し、1012 前の over-broad ポリシーを復帰する（緊急時のみ）。
-- ⚠️ 復帰すると custom_events の越境 write/delete・anon 全読みが再び開く。
-- ヘルパー is_organization_member は残す（他で使用される可能性・無害）。冪等。
-- ============================================================================

begin;

drop policy if exists "authed_custom_events_insert_by_session_manager" on public.custom_events;
drop policy if exists "authed_custom_events_update_by_session_manager" on public.custom_events;
drop policy if exists "authed_custom_events_delete_by_session_manager" on public.custom_events;
drop policy if exists "anon_custom_events_select_by_jwt" on public.custom_events;

create policy "Authenticated users can insert custom events"
  on public.custom_events for insert to authenticated with check (true);
create policy "Authenticated users can update custom events"
  on public.custom_events for update to authenticated using (true);
create policy "Authenticated users can delete custom events"
  on public.custom_events for delete to authenticated using (true);
create policy "Anonymous users can view custom events"
  on public.custom_events for select to anon using (true);

commit;
