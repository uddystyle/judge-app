-- ============================================================================
-- ROLLBACK for 1013_organizations_write_lockdown.sql
-- ============================================================================
-- admin スコープの UPDATE/DELETE を撤去し、1013 前の over-broad（=true）を復帰（緊急時のみ）。
-- ⚠️ 復帰すると任意の認証ユーザーが任意の組織を改変/削除できる状態に戻る。
-- ヘルパー is_organization_admin は残す（無害）。冪等。
-- ============================================================================

begin;

drop policy if exists "authed_organizations_update_by_admin" on public.organizations;
drop policy if exists "authed_organizations_delete_by_admin" on public.organizations;

create policy "update_organization"
  on public.organizations for update to authenticated using (true) with check (true);
create policy "delete_organization"
  on public.organizations for delete to authenticated using (true);

commit;
