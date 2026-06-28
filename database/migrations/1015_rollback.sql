-- ============================================================================
-- ROLLBACK for 1015_org_members_drop_overbroad_select.sql
-- ============================================================================
-- `select_all_memberships`(=true) を復帰（緊急時のみ）。
-- ⚠️ 復帰すると任意の認証ユーザーが全組織の所属を越境列挙できる状態に戻る。冪等。
-- ============================================================================

drop policy if exists "select_all_memberships" on public.organization_members;
create policy "select_all_memberships"
  on public.organization_members for select to authenticated using (true);
