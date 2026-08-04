-- ============================================================================
-- Rollback for Migration 1025: ゲスト身元の auth.uid() 束縛を撤回
-- ============================================================================
-- 緊急時のみ。**撤回するとなりすましの穴が再び開く**（user_metadata は本人が
-- updateUser({data}) で書き換えられるため、同一セッションの参加者が他ゲストの
-- guest_identifier を騙って参加行を改変・削除できる状態に戻る）。
-- また anon_*_by_jwt 群を復元しても、ゲストは authenticated ロールで来るため
-- それらは発火せず、ゲストの採点保存はできないまま（1025 以前の壊れた状態）になる。
--
-- session_participants.user_id のバックフィルは**戻さない**。旧ポリシーは user_id を
-- 見ないので残っていても無害で、消すと再適用時に再バックフィルが必要になるため。
-- アプリを 1025 以前へ戻す場合は、アプリ側の user_id 束縛コードも同時に戻すこと。
-- 冪等。
-- ============================================================================

begin;

-- (5) の撤回: ゲスト owner 書込みポリシー
drop policy if exists "guest_results_insert_by_owner"          on public.results;
drop policy if exists "guest_results_update_by_owner"          on public.results;
drop policy if exists "guest_training_scores_insert_by_owner"  on public.training_scores;
drop policy if exists "guest_training_scores_update_by_owner"  on public.training_scores;
drop policy if exists "guest_training_scores_delete_by_owner"  on public.training_scores;

-- (4) の撤回: anon_*_by_jwt 群を user_metadata 版で復元
create policy "anon_sessions_select_by_jwt"
  on public.sessions for select to anon
  using (id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint);

create policy "anon_session_participants_select_by_jwt"
  on public.session_participants for select to anon
  using (session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint);

create policy "anon_participants_select_by_jwt"
  on public.participants for select to anon
  using (session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint);

create policy "anon_participants_insert_by_jwt"
  on public.participants for insert to anon
  with check (session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint);

create policy "anon_custom_events_select_by_jwt"
  on public.custom_events for select to anon
  using (session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint);

create policy "anon_scoring_prompts_by_jwt"
  on public.scoring_prompts for all to anon
  using (session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint)
  with check (session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint);

create policy "anon_results_select_scoped_by_jwt"
  on public.results for select to anon
  using (
    session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint
    and exists (
      select 1 from public.session_participants sp
      where sp.session_id = results.session_id
        and sp.is_guest = true
        and sp.guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
    )
  );

create policy "anon_results_insert_by_owner"
  on public.results for insert to anon
  with check (
    session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint
    and guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
    and exists (
      select 1 from public.session_participants sp
      where sp.session_id = results.session_id
        and sp.is_guest = true
        and sp.guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
    )
  );

create policy "anon_results_update_by_owner"
  on public.results for update to anon
  using (
    session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint
    and guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
  )
  with check (
    session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint
    and guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
  );

create policy "anon_training_scores_select_scoped_by_jwt"
  on public.training_scores for select to anon
  using (
    event_id in (
      select te.id from public.training_events te
      where te.session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint
    )
    and exists (
      select 1 from public.training_events te
      join public.session_participants sp on sp.session_id = te.session_id
      where te.id = training_scores.event_id
        and sp.is_guest = true
        and sp.guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
        and sp.session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint
    )
  );

create policy "anon_training_scores_insert_scoped_by_jwt"
  on public.training_scores for insert to anon
  with check (
    guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
    and event_id in (
      select te.id from public.training_events te
      where te.session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint
    )
    and exists (
      select 1 from public.training_events te
      join public.session_participants sp on sp.session_id = te.session_id
      where te.id = training_scores.event_id
        and sp.is_guest = true
        and sp.guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
        and sp.session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint
    )
  );

create policy "anon_training_scores_update_scoped_by_jwt"
  on public.training_scores for update to anon
  using (
    guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
    and exists (
      select 1 from public.training_events te
      join public.session_participants sp on sp.session_id = te.session_id
      where te.id = training_scores.event_id
        and sp.is_guest = true
        and sp.guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
        and sp.session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint
    )
  )
  with check (
    guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
    and exists (
      select 1 from public.training_events te
      join public.session_participants sp on sp.session_id = te.session_id
      where te.id = training_scores.event_id
        and sp.is_guest = true
        and sp.guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
        and sp.session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint
    )
  );

create policy "anon_training_scores_delete_scoped_by_jwt"
  on public.training_scores for delete to anon
  using (
    guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
    and exists (
      select 1 from public.training_events te
      join public.session_participants sp on sp.session_id = te.session_id
      where te.id = training_scores.event_id
        and sp.is_guest = true
        and sp.guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier')
        and sp.session_id = (nullif(((auth.jwt() -> 'user_metadata') ->> 'session_id'), ''))::bigint
    )
  );

-- prod の旧定義（USING true）で復元する。dev では 1025 以前に app_metadata で
-- スコープされていたが、その状態は「埋める仕組みが無く機能しない」ため復元しない。
create policy "Anonymous users can view training events"
  on public.training_events for select to anon
  using (true);

-- (3) の撤回: session_participants の user_metadata 句を復元（⚠️ なりすまし穴が再び開く）
drop policy if exists "Users and guests can update their own participation" on public.session_participants;
create policy "Users and guests can update their own participation"
  on public.session_participants for update to public
  using (
    auth.uid() = user_id
    or (is_guest = true and guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier'))
  )
  with check (
    auth.uid() = user_id
    or (is_guest = true and guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier'))
  );

drop policy if exists "Owner, session manager, or org admin can delete participation" on public.session_participants;
create policy "Owner, session manager, or org admin can delete participation"
  on public.session_participants for delete to authenticated
  using (
    auth.uid() = user_id
    or (is_guest = true and guest_identifier = ((auth.jwt() -> 'user_metadata') ->> 'guest_identifier'))
    or public.can_manage_session_participants(session_id)
  );

-- (2) の撤回: ヘルパ関数
drop function if exists public.current_guest_identifier(bigint);

commit;
