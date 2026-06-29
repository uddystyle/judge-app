-- ============================================================================
-- ROLLBACK for 1007_rls_lockdown_cross_session.sql
-- ============================================================================
-- ⚠️ 緊急時のみ。これは 1007 で塞いだ過剰許可（=true）ポリシーを**再導入**し、
--    越境読み書きの穴を元に戻します。1007 が prod の正規フローを壊した場合の
--    一時退避用。適用後は速やかに正しいスコープ付きポリシーへ再修正すること。
-- 冪等。is_session_member 関数は残しても無害なので削除しない。
-- ============================================================================

-- 1) 1007 が追加した canonical ポリシーを撤去
drop policy if exists "anon_scoring_prompts_by_jwt" on public.scoring_prompts;
drop policy if exists "auth_scoring_prompts_by_participation" on public.scoring_prompts;
drop policy if exists "anon_participants_select_by_jwt" on public.participants;
drop policy if exists "anon_participants_insert_by_jwt" on public.participants;
drop policy if exists "auth_participants_insert_by_participation" on public.participants;
drop policy if exists "anon_session_participants_select_by_jwt" on public.session_participants;
drop policy if exists "auth_session_participants_select_by_membership" on public.session_participants;

-- 2) 1007 が撤去した over-broad ポリシーを復帰（穴を再導入）

-- results
drop policy if exists "authenticated_users_select_results" on public.results;
create policy "authenticated_users_select_results" on public.results
  for select to authenticated using (true);
drop policy if exists "authenticated_users_insert_results" on public.results;
create policy "authenticated_users_insert_results" on public.results
  for insert to authenticated with check (true);
drop policy if exists "authenticated_users_update_results" on public.results;
create policy "authenticated_users_update_results" on public.results
  for update to authenticated using (true) with check (true);

-- scoring_prompts
drop policy if exists "anon_users_select_scoring_prompts" on public.scoring_prompts;
create policy "anon_users_select_scoring_prompts" on public.scoring_prompts
  for select to anon using (true);
drop policy if exists "anon_users_insert_scoring_prompts" on public.scoring_prompts;
create policy "anon_users_insert_scoring_prompts" on public.scoring_prompts
  for insert to anon with check (true);
drop policy if exists "anon_users_update_scoring_prompts" on public.scoring_prompts;
create policy "anon_users_update_scoring_prompts" on public.scoring_prompts
  for update to anon using (true) with check (true);
drop policy if exists "authenticated_users_select_scoring_prompts" on public.scoring_prompts;
create policy "authenticated_users_select_scoring_prompts" on public.scoring_prompts
  for select to authenticated using (true);
drop policy if exists "authenticated_users_insert_scoring_prompts" on public.scoring_prompts;
create policy "authenticated_users_insert_scoring_prompts" on public.scoring_prompts
  for insert to authenticated with check (true);
drop policy if exists "authenticated_users_update_scoring_prompts" on public.scoring_prompts;
create policy "authenticated_users_update_scoring_prompts" on public.scoring_prompts
  for update to authenticated using (true) with check (true);
drop policy if exists "authenticated_users_delete_scoring_prompts" on public.scoring_prompts;
create policy "authenticated_users_delete_scoring_prompts" on public.scoring_prompts
  for delete to authenticated using (true);

-- participants
drop policy if exists "Anonymous users can view participants" on public.participants;
create policy "Anonymous users can view participants" on public.participants
  for select to anon using (true);
drop policy if exists "Authenticated users can view participants" on public.participants;
create policy "Authenticated users can view participants" on public.participants
  for select to authenticated using (true);
drop policy if exists "Authenticated users can insert participants" on public.participants;
create policy "Authenticated users can insert participants" on public.participants
  for insert to authenticated with check (true);
drop policy if exists "Authenticated users can update participants" on public.participants;
create policy "Authenticated users can update participants" on public.participants
  for update to authenticated using (true);
drop policy if exists "Authenticated users can delete participants" on public.participants;
create policy "Authenticated users can delete participants" on public.participants
  for delete to authenticated using (true);
drop policy if exists "Anonymous users can insert participants in their sessions" on public.participants;
create policy "Anonymous users can insert participants in their sessions" on public.participants
  for insert to anon
  with check (session_id in (select session_participants.session_id
                             from public.session_participants
                             where session_participants.is_guest = true));

-- session_participants
drop policy if exists "Anonymous users can view session participants" on public.session_participants;
create policy "Anonymous users can view session participants" on public.session_participants
  for select to anon using (true);
drop policy if exists "Authenticated users can view session participants" on public.session_participants;
create policy "Authenticated users can view session participants" on public.session_participants
  for select to authenticated using (true);
