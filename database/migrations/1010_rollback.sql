-- ============================================================================
-- ROLLBACK for 1010_results_owner_enforce.sql
-- ============================================================================
-- RLS を 1009 段階（旧 name 基準）へ戻す。owner 列/部分一意索引（1009）は残す。
-- ⚠️ 旧 name-based UNIQUE は再追加しない（phase2 中に同名・別 owner 行が生まれていると
--    再追加が失敗するため）。RLS だけを旧方式へ戻すことで、新旧どちらのアプリでも動く状態に復帰する。
-- 冪等。
-- ============================================================================

-- owner 基準ポリシーを撤去
drop policy if exists "anon_results_insert_by_owner" on public.results;
drop policy if exists "anon_results_update_by_owner" on public.results;
drop policy if exists "auth_results_insert_by_owner" on public.results;
drop policy if exists "auth_results_update_by_owner" on public.results;

-- 旧 RLS を復帰（guest_name=judge_name / session スコープ）
drop policy if exists "anon_results_insert_scoped_by_jwt" on public.results;
create policy "anon_results_insert_scoped_by_jwt"
  on public.results for insert to anon
  with check (
    session_id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint
    and exists (
      select 1 from public.session_participants sp
      where sp.session_id = results.session_id
        and sp.is_guest = true
        and sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
        and sp.guest_name = results.judge_name
    )
  );

drop policy if exists "anon_results_update_scoped_by_jwt" on public.results;
create policy "anon_results_update_scoped_by_jwt"
  on public.results for update to anon
  using (
    session_id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint
    and exists (
      select 1 from public.session_participants sp
      where sp.session_id = results.session_id
        and sp.is_guest = true
        and sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
        and sp.guest_name = results.judge_name
    )
  )
  with check (
    session_id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint
    and exists (
      select 1 from public.session_participants sp
      where sp.session_id = results.session_id
        and sp.is_guest = true
        and sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
        and sp.guest_name = results.judge_name
    )
  );

drop policy if exists "Authenticated users can insert results in their sessions" on public.results;
create policy "Authenticated users can insert results in their sessions"
  on public.results for insert to authenticated
  with check (
    session_id in (select session_id from public.session_participants where user_id = auth.uid())
  );

drop policy if exists "Authenticated users can update their own results" on public.results;
create policy "Authenticated users can update their own results"
  on public.results for update to authenticated
  using (
    session_id in (select session_id from public.session_participants where user_id = auth.uid())
    and judge_name in (select full_name from public.profiles where id = auth.uid())
  )
  with check (
    session_id in (select session_id from public.session_participants where user_id = auth.uid())
    and judge_name in (select full_name from public.profiles where id = auth.uid())
  );
