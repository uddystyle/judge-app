-- ============================================================================
-- Migration 1008: sessions anon SELECT lockdown
-- ============================================================================
-- WHY: sessions の anon SELECT が `USING true`（prod・dev 両方）＋ prod に
--      "Temporary realtime test"(true) / "Authenticated users can view sessions."
--      (auth.role()='authenticated') 等 → anon が全セッションを読め、
--      join_code / invite_token 列が漏洩（参加コード/招待ゲートの実質バイパス）。
--
-- WHAT: anon SELECT を JWT の自 session_id に限定。過剰な anon/public SELECT を撤去。
--       認証ユーザーは既存のスコープ付き（participant / org / creator / chief / admin-deleted）
--       ポリシーで読む（維持）。ゲストの realtime（active_prompt_id 監視, filter id=eq）は
--       JWT スコープで継続（1001 と同方式・realtime は RLS 準拠で動作）。
--
-- ⚠️ 前提（順序厳守）: アプリ側の service-role 化を**先にデプロイ**してから本 migration を適用する。
--    - /session/join, /session/invite/[token] の参加コード/招待トークン照合 → supabaseAdmin
--    - /scoreboard/[sessionId]（公開）の sessions/custom_events/results 取得 → supabaseAdmin
--    （service-role 参照は RLS 状態に依らず動くため、デプロイと適用の間にギャップがあっても壊れない）
--
-- 適用: DEV 先行 → 末尾検証 over-broad=0 と手動E2E（join/invite/公開scoreboard/ゲストrealtime）
--       → prod。冪等。問題時は 1008_rollback_sessions_anon_lockdown.sql。
-- ============================================================================

-- 過剰な anon / public SELECT を撤去（prod・dev の別名を網羅）
drop policy if exists "Anonymous users can view sessions" on public.sessions;
drop policy if exists "Anonymous users can view all sessions" on public.sessions;
drop policy if exists "Anonymous users can view sessions via invite token" on public.sessions;
drop policy if exists "Anyone can view sessions by invite token" on public.sessions;
drop policy if exists "Authenticated users can view sessions." on public.sessions;
drop policy if exists "Temporary realtime test" on public.sessions;

-- canonical: anon は自分の JWT の session_id の行だけ読める
drop policy if exists "anon_sessions_select_by_jwt" on public.sessions;
create policy "anon_sessions_select_by_jwt"
  on public.sessions
  for select
  to anon
  using (id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint);

-- ----------------------------------------------------------------------------
-- 検証スナップショット
-- ----------------------------------------------------------------------------
do $$
declare
  broad_count int;
begin
  select count(*) into broad_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'sessions'
    and cmd in ('SELECT', 'ALL')
    and ('anon' = any(roles::text[]) or 'public' = any(roles::text[]))
    and (coalesce(qual, '') = 'true' or coalesce(qual, '') ilike '%auth.role()%');
  raise notice 'Remaining broad anon/public sessions SELECT/ALL policies: %', broad_count;
end $$;

select
  policyname,
  cmd,
  roles::text as roles,
  left(coalesce(qual, ''), 110) as using_preview
from pg_policies
where schemaname = 'public'
  and tablename = 'sessions'
order by cmd, policyname;
