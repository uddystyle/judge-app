-- ============================================================================
-- Migration 1013: organizations の越境 update/delete を塞ぐ（RLS ロックダウン）
-- ============================================================================
-- WHY: prod/dev は organizations に authed UPDATE `update_organization`(=true) /
--      DELETE `delete_organization`(=true)（017）が残存 → 任意の認証ユーザーが
--      任意の組織を改変/削除でき、連鎖でデータ消失しうる。
-- WHAT: UPDATE/DELETE を org の admin（role='admin' かつ removed_at IS NULL）に限定。
-- NOTE: SELECT(=true)（010/017）と INSERT(=true) は本バッチでは触らない
--       （SELECT は READ Med 群・別バッチ／INSERT は org 作成が RPC(service-role) で Low）。
-- アプリ: org update/delete は authed クライアント経由＝RLS 依存。アプリ側 admin チェックは
--       既存だが RLS でも強制する。アプリ変更なし。冪等。DEV 先行 → prod。問題時 1013_rollback.sql。
-- ============================================================================

begin;

-- 非再帰ヘルパー（無ければ作成。既存ならそのまま使う＝42P13 回避）。
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'is_organization_admin') then
    create function public.is_organization_admin(org_id uuid)
    returns boolean language plpgsql security definer as $fn$
    begin
      return exists (
        select 1 from public.organization_members
        where organization_id = org_id
          and user_id = auth.uid()
          and role = 'admin'
          and removed_at is null
      );
    end;
    $fn$;
  end if;
end $$;

-- 過剰ポリシーを撤去
drop policy if exists "update_organization" on public.organizations;
drop policy if exists "delete_organization" on public.organizations;

-- UPDATE/DELETE は org admin のみ
create policy "authed_organizations_update_by_admin"
  on public.organizations for update to authenticated
  using (public.is_organization_admin(id))
  with check (public.is_organization_admin(id));

create policy "authed_organizations_delete_by_admin"
  on public.organizations for delete to authenticated
  using (public.is_organization_admin(id));

commit;

-- 検証
select policyname, cmd, roles::text as roles
from pg_policies
where schemaname = 'public' and tablename = 'organizations'
order by cmd, policyname;
