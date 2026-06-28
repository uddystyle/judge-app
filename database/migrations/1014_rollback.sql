-- ============================================================================
-- ROLLBACK for 1014_custom_events_select_lockdown.sql
-- ============================================================================
-- scoped な authed SELECT を撤去し、1014 前の over-broad（=true）を復帰（緊急時のみ）。
-- ⚠️ 復帰すると任意の認証ユーザーが全 org/全セッションの種目を越境閲覧できる状態に戻る。
-- 冪等。
-- ============================================================================

begin;

drop policy if exists "authed_custom_events_select_by_member" on public.custom_events;

create policy "Authenticated users can view custom events"
  on public.custom_events for select to authenticated using (true);

commit;
