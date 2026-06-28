-- ============================================================================
-- Migration 1014: custom_events の authed SELECT を scope（越境閲覧を塞ぐ）
-- ============================================================================
-- WHY: prod/dev は custom_events に authed SELECT `Authenticated users can view
--      custom events`(=true, 030) が残存 → 任意の認証ユーザーが全 org/全セッションの
--      種目定義を越境閲覧できる。
-- WHAT: authed SELECT を「session 参加者（判定員）OR session の org メンバー」に限定。
-- NOTE: write/delete・anon SELECT は 1012 で scope 済み。公開 scoreboard は service-role
--       （RLS バイパス）で無影響。ヘルパーは 1007/1012 で既に存在（SECURITY DEFINER・非再帰）。
-- DBのみ・アプリ無変更・冪等。DEV 先行 → prod。問題時は 1014_rollback.sql。
-- ============================================================================

begin;

-- 過剰な authed SELECT を撤去
drop policy if exists "Authenticated users can view custom events" on public.custom_events;

-- authed SELECT: session 参加者 OR session の org メンバーのみ
create policy "authed_custom_events_select_by_member"
  on public.custom_events for select to authenticated
  using (
    public.is_session_member(session_id)
    or exists (
      select 1 from public.sessions s
      where s.id = custom_events.session_id
        and public.is_organization_member(s.organization_id, auth.uid())
    )
  );

commit;

-- 検証
select policyname, cmd, roles::text as roles
from pg_policies
where schemaname = 'public' and tablename = 'custom_events'
order by cmd, policyname;
