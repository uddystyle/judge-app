-- ============================================================================
-- ROLLBACK for 1008_sessions_anon_lockdown.sql
-- ============================================================================
-- ⚠️ 緊急時のみ。sessions の anon 全読み（join_code / invite_token 漏洩）を**再導入**します。
--    1008 適用後に join/invite/公開scoreboard が壊れた場合の一時退避用。
--    本来はアプリの service-role 化を先に直すこと。冪等。
-- ============================================================================

-- 1008 が追加した canonical を撤去
drop policy if exists "anon_sessions_select_by_jwt" on public.sessions;

-- 1008 が撤去した broad ポリシーを復帰（穴を再導入）
drop policy if exists "Anonymous users can view sessions" on public.sessions;
create policy "Anonymous users can view sessions" on public.sessions
  for select to anon using (true);
