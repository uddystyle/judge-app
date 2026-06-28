-- ============================================================================
-- Migration 1017: profiles の SELECT を can_view_profile でスコープ
-- ============================================================================
-- WHY: prod/dev は profiles に `Allow users to read all profiles`(authed SELECT USING true)
--      が残存 → 任意の認証ユーザーが全ユーザーの profiles（full_name=PII 等）を越境閲覧。
-- WHAT: 「自分 ∨ 同一 session ∨ 同一 org」だけ読める can_view_profile(uuid) でスコープ。
-- NOTE: helper は session_participants/organization_members を SECURITY DEFINER で直接参照
--       （RLS バイパス・profiles へ戻らない＝非再帰）。判定員名表示・メンバー一覧・archive の
--       削除済メンバー名はカバー。scoreActions の full_name 逆引きは新 RLS で自動スコープ。
--       email の列レベル保護は対象外（行スコープ化のみ）。
-- DBのみ・アプリ無変更・冪等。DEV 先行 → prod。問題時は 1017_rollback.sql。
-- ============================================================================

begin;

-- 可視判定ヘルパー（own ∨ 同一session ∨ 同一org）。SECURITY DEFINER・STABLE・非再帰。
create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    p_profile_id = auth.uid()
    or exists (
      select 1
      from public.session_participants sp_self
      join public.session_participants sp_t
        on sp_t.session_id = sp_self.session_id
      where sp_self.user_id = auth.uid()
        and sp_t.user_id = p_profile_id
    )
    or exists (
      select 1
      from public.organization_members om_self
      join public.organization_members om_t
        on om_t.organization_id = om_self.organization_id
      where om_self.user_id = auth.uid()
        and om_self.removed_at is null
        and om_t.user_id = p_profile_id
    );
$$;

-- 過剰 SELECT を撤去 → スコープ付きへ
drop policy if exists "Allow users to read all profiles" on public.profiles;

create policy "profiles_select_visible"
  on public.profiles for select to authenticated
  using (public.can_view_profile(id));

commit;

-- 検証
select policyname, cmd, roles::text as roles, left(coalesce(qual, ''), 80) as using_expr
from pg_policies
where schemaname = 'public' and tablename = 'profiles'
order by cmd, policyname;
