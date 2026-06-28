-- ============================================================================
-- ROLLBACK for 1016_organizations_select_lockdown.sql
-- ============================================================================
-- member スコープ SELECT を撤去し、1016 前の over-broad（=true）を復帰（緊急時のみ）。
-- ⚠️ 復帰すると任意の認証/匿名ユーザーが全組織を越境閲覧できる状態に戻る。冪等。
-- ============================================================================

begin;

drop policy if exists "authed_organizations_select_by_member" on public.organizations;

create policy "select_organization"
  on public.organizations for select to authenticated using (true);
create policy "Anyone can view organizations for sessions"
  on public.organizations for select using (true);

commit;
