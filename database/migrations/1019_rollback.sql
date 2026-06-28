-- ============================================================================
-- ROLLBACK for 1019_organizations_admin_consolidate.sql
-- ============================================================================
-- 020 由来の inline admin UPDATE/DELETE ポリシー（removed_at 未チェック）を復帰（緊急時のみ）。
-- ※ 復帰すると soft-removed admin が同 org を改変/削除できる緩い状態に戻る。
-- ※ 1013 の authed_organizations_{update,delete}_by_admin は本ロールバックでは触らない（共存）。冪等。
-- ============================================================================

begin;

drop policy if exists "Admins can update their organization" on public.organizations;
create policy "Admins can update their organization"
  on public.organizations for update to authenticated
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = organizations.id
        and organization_members.user_id = auth.uid()
        and organization_members.role = 'admin'
    )
  );

drop policy if exists "Admins can delete their organization" on public.organizations;
create policy "Admins can delete their organization"
  on public.organizations for delete to authenticated
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = organizations.id
        and organization_members.user_id = auth.uid()
        and organization_members.role = 'admin'
    )
  );

-- 注: `Organization admins can update their organization`(public) は元定義が不明のため復帰しない
--    （1013 の admin UPDATE が機能を担保するため実害なし）。
commit;
