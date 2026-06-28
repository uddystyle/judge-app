-- ============================================================================
-- ROLLBACK for 1018_organizations_drop_authed_insert.sql
-- ============================================================================
-- authed INSERT(=true) を復帰（緊急時のみ・authed クライアントでの org 作成を一時的に許す場合）。冪等。
-- ============================================================================

drop policy if exists "Authenticated users can create organizations" on public.organizations;
create policy "Authenticated users can create organizations"
  on public.organizations for insert to authenticated with check (true);
