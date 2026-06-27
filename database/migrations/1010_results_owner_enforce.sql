-- ============================================================================
-- Migration 1010 (#7 phase 2): enforce owner on results
-- ============================================================================
-- ⚠️ 前提: 1009 を適用済み、かつ owner を書く**新アプリをデプロイ済み**であること。
--    （旧アプリ稼働中に適用すると、judge_id 未設定の INSERT が authed RLS で弾かれる）
-- WHAT: 旧 name-unique を撤去し、RLS を owner（authed=judge_id / guest=guest_identifier）基準へ。
--       これで同名の検定員でも別行として保存され、相互上書き／なりすましが根治する。
-- 冪等。DEV 先行 → prod。問題時は 1010_rollback.sql（RLS を 1009 段階＝旧 name 基準へ戻す）。
-- ============================================================================

-- 1) 旧 name-based UNIQUE を撤去（prod/dev 別名を網羅。owner 部分一意索引が後継）
alter table public.results drop constraint if exists results_unique_score_entry;
alter table public.results drop constraint if exists results_unique_score;
alter table public.results drop constraint if exists unique_result_per_judge;

-- 2) RLS を owner 基準へ差し替え（INSERT/UPDATE のみ。SELECT/DELETE は既存の session/chief スコープ維持）

-- anon: 旧 guest_name=judge_name 方式を撤去 → guest_identifier=JWT 方式へ
drop policy if exists "anon_results_insert_scoped_by_jwt" on public.results;
drop policy if exists "anon_results_update_scoped_by_jwt" on public.results;

create policy "anon_results_insert_by_owner"
  on public.results for insert to anon
  with check (
    session_id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint
    and guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
    and exists (
      select 1 from public.session_participants sp
      where sp.session_id = results.session_id
        and sp.is_guest = true
        and sp.guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
    )
  );

create policy "anon_results_update_by_owner"
  on public.results for update to anon
  using (
    session_id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint
    and guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
  )
  with check (
    session_id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint
    and guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
  );

-- authed: 旧 session-only INSERT / judge_name=full_name UPDATE を撤去 → judge_id=auth.uid() 方式へ
drop policy if exists "Authenticated users can insert results in their sessions" on public.results;
drop policy if exists "Authenticated users can update their own results" on public.results;

create policy "auth_results_insert_by_owner"
  on public.results for insert to authenticated
  with check (
    judge_id = auth.uid()
    and session_id in (select session_id from public.session_participants where user_id = auth.uid())
  );

create policy "auth_results_update_by_owner"
  on public.results for update to authenticated
  using (
    judge_id = auth.uid()
    and session_id in (select session_id from public.session_participants where user_id = auth.uid())
  )
  with check (
    judge_id = auth.uid()
    and session_id in (select session_id from public.session_participants where user_id = auth.uid())
  );

-- 検証スナップショット
do $$
declare
  name_unique int;
begin
  select count(*) into name_unique
  from pg_constraint
  where conrelid = 'public.results'::regclass and contype = 'u'
    and pg_get_constraintdef(oid) ilike '%judge_name%';
  raise notice '1010: remaining name-based UNIQUE constraints on results: %', name_unique;
end $$;

select policyname, cmd, roles::text as roles, left(coalesce(qual, ''), 80) as using_preview,
       left(coalesce(with_check, ''), 80) as with_check_preview
from pg_policies
where schemaname = 'public' and tablename = 'results'
order by cmd, policyname;
