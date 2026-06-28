-- ============================================================================
-- Migration 1016: organizations の authed/public SELECT を member スコープへ
-- ============================================================================
-- ⚠️ 前提: アプリ（organization/join・onboarding/create-organization の org 参照を
--    service-role 化）を**先にデプロイ済み**であること。逆順だと旧アプリの参加/作成が壊れる。
-- WHY: prod/dev は organizations に `Anyone can view organizations for sessions`(public=true,010)
--      ＋ `select_organization`(authed=true,017) が残存 → 任意の認証/匿名ユーザーが全組織を越境閲覧。
-- WHAT: 過剰 SELECT を撤去し、authed SELECT を org メンバーに限定（is_organization_member）。
-- NOTE: 非メンバーが org を読む正規経路（招待コード参加・新規作成の読み戻し）は service-role 化済み。
--       INSERT(true) は本バッチでは触らない（Low）。冪等。DEV 先行 → prod。問題時 1016_rollback.sql。
-- ============================================================================

begin;

-- 非再帰ヘルパー（無ければ作成。既存ならそのまま＝42P13 回避）
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'is_organization_member') then
    create function public.is_organization_member(org_id uuid, check_user_id uuid)
    returns boolean language plpgsql security definer as $fn$
    begin
      return exists (
        select 1 from public.organization_members
        where organization_id = org_id and user_id = check_user_id and removed_at is null
      );
    end;
    $fn$;
  end if;
end $$;

-- 過剰 SELECT を撤去
drop policy if exists "Anyone can view organizations for sessions" on public.organizations;
drop policy if exists "select_organization" on public.organizations;

-- authed SELECT は org メンバーのみ（非再帰・SECURITY DEFINER ヘルパー）
create policy "authed_organizations_select_by_member"
  on public.organizations for select to authenticated
  using (public.is_organization_member(id, auth.uid()));

commit;

-- 検証
select policyname, cmd, roles::text as roles, left(coalesce(qual, ''), 100) as using_expr
from pg_policies
where schemaname = 'public' and tablename = 'organizations'
order by cmd, policyname;
