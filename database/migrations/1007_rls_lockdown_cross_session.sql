-- ============================================================================
-- Migration 1007: RLS lockdown — remove cross-session/cross-tenant over-broad
-- policies on results / scoring_prompts / participants / session_participants.
-- ============================================================================
-- WHY: 突合(audit_schema_rls.sql)で本番に過剰許可ポリシーが判明：
--   - results: authenticated_users_{select,insert,update}_results = true
--     → 任意の認証ユーザーが全org/全セッションの得点を読取・改ざん可能（CRIT）
--   - scoring_prompts: anon/authed が全面 true（越境プロンプト改ざん）
--   - participants / session_participants: anon SELECT 等が true（越境PII・ロスター操作）
--
-- WHAT: anon を JWT(session_id) スコープ、authed をセッション参加スコープへ統一。
--   アプリ変更は不要（ゲストの読書きは自セッションに閉じている）。
--
-- 適用順: **DEV に先に適用** → audit_schema_rls.sql (4)(5) で true 残存ゼロを確認
--         → DEV 手動E2E（ゲスト/認証の採点・realtime・scoreboard）→ prod。
-- 冪等: 何度実行しても安全（DROP POLICY IF EXISTS → CREATE）。
-- ロールバック: 1007_rollback_rls_lockdown.sql（緊急時のみ。穴を再導入する点に注意）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) 再帰回避用ヘルパ（session_participants の authed SELECT が自テーブルを
--    参照しても RLS 再帰しないよう SECURITY DEFINER）。
--    ※ 既に is_session_member(bigint) が存在する環境（prod は引数名 session_uuid）
--      では CREATE OR REPLACE が引数名を変更できず 42P13 になるため、「無ければ作る」
--      方式にする。ポリシーは位置引数で呼ぶので引数名は不問。既存（prod の正規ヘルパ）
--      をそのまま再利用する。冪等。
-- ----------------------------------------------------------------------------
do $$
begin
  -- 「作ってみて、既に存在(42723)なら既存をそのまま再利用」する。
  -- CREATE OR REPLACE は引数名(prod=session_uuid / dev=p_session_id)を変更できず 42P13 になるため使わない。
  begin
    execute $fn$
      create function public.is_session_member(p_session_id bigint)
      returns boolean
      language sql
      security definer
      set search_path = public
      stable
      as $body$
        select exists (
          select 1
          from public.session_participants
          where session_id = p_session_id
            and user_id = auth.uid()
        );
      $body$
    $fn$;
  exception
    when duplicate_function then
      raise notice 'is_session_member(bigint) は既に存在するため既存を再利用します';
  end;
end $$;


-- ----------------------------------------------------------------------------
-- 1) results — 過剰な authed=true ポリシーを撤去（スコープ付き正ポリシーは維持）
--    維持: chief_judge_can_delete_results,
--          "Authenticated users can {view,insert,update ...} in their sessions",
--          anon_results_*_scoped_by_jwt
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated_users_select_results" on public.results;
drop policy if exists "authenticated_users_insert_results" on public.results;
drop policy if exists "authenticated_users_update_results" on public.results;


-- ----------------------------------------------------------------------------
-- 2) scoring_prompts — 全面 true を撤去し、anon=JWT / authed=参加 スコープへ
-- ----------------------------------------------------------------------------
drop policy if exists "anon_users_insert_scoring_prompts" on public.scoring_prompts;
drop policy if exists "anon_users_select_scoring_prompts" on public.scoring_prompts;
drop policy if exists "anon_users_update_scoring_prompts" on public.scoring_prompts;
drop policy if exists "authenticated_users_insert_scoring_prompts" on public.scoring_prompts;
drop policy if exists "authenticated_users_select_scoring_prompts" on public.scoring_prompts;
drop policy if exists "authenticated_users_update_scoring_prompts" on public.scoring_prompts;
drop policy if exists "authenticated_users_delete_scoring_prompts" on public.scoring_prompts;
drop policy if exists "Anonymous users can view scoring prompts" on public.scoring_prompts;
drop policy if exists "Authenticated users can manage scoring prompts" on public.scoring_prompts;
drop policy if exists "Authenticated users can view scoring prompts" on public.scoring_prompts;

drop policy if exists "anon_scoring_prompts_by_jwt" on public.scoring_prompts;
create policy "anon_scoring_prompts_by_jwt"
  on public.scoring_prompts
  for all
  to anon
  using (session_id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint)
  with check (session_id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint);

drop policy if exists "auth_scoring_prompts_by_participation" on public.scoring_prompts;
create policy "auth_scoring_prompts_by_participation"
  on public.scoring_prompts
  for all
  to authenticated
  using (session_id in (select session_id from public.session_participants where user_id = auth.uid()))
  with check (session_id in (select session_id from public.session_participants where user_id = auth.uid()));


-- ----------------------------------------------------------------------------
-- 3) participants — 過剰な true を撤去し、anon=JWT(SELECT/INSERT) /
--    authed INSERT=参加スコープ を追加。作成者管理ポリシーは維持。
--    維持: "Session creators can manage/insert/update/delete participants",
--          "Participants can view participants", "Session participants can view participants"
-- ----------------------------------------------------------------------------
drop policy if exists "Anonymous users can view participants" on public.participants;
drop policy if exists "Authenticated users can view participants" on public.participants;
drop policy if exists "Authenticated users can insert participants" on public.participants;
drop policy if exists "Authenticated users can update participants" on public.participants;
drop policy if exists "Authenticated users can delete participants" on public.participants;
drop policy if exists "Anonymous users can insert participants in their sessions" on public.participants;

drop policy if exists "anon_participants_select_by_jwt" on public.participants;
create policy "anon_participants_select_by_jwt"
  on public.participants
  for select
  to anon
  using (session_id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint);

drop policy if exists "anon_participants_insert_by_jwt" on public.participants;
create policy "anon_participants_insert_by_jwt"
  on public.participants
  for insert
  to anon
  with check (session_id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint);

drop policy if exists "auth_participants_insert_by_participation" on public.participants;
create policy "auth_participants_insert_by_participation"
  on public.participants
  for insert
  to authenticated
  with check (session_id in (select session_id from public.session_participants where user_id = auth.uid()));


-- ----------------------------------------------------------------------------
-- 4) session_participants — 越境 SELECT を撤去し、anon=JWT / authed=参加 へ。
--    維持: "Users can view their own participations", INSERT(join as themselves),
--          UPDATE/DELETE（自分/ゲスト/manager）
-- ----------------------------------------------------------------------------
drop policy if exists "Anonymous users can view session participants" on public.session_participants;
drop policy if exists "Anyone can view guest participants for validation" on public.session_participants;
drop policy if exists "Authenticated users can view session participants" on public.session_participants;
-- ↑ dev の名前。prod は同義ポリシーが下記の別名（"... participants"）で存在するため両方 drop する。
drop policy if exists "Authenticated users can view participants" on public.session_participants;
drop policy if exists "Users and guests can view session participants" on public.session_participants;
drop policy if exists "Members can view all participants in their sessions" on public.session_participants;

drop policy if exists "anon_session_participants_select_by_jwt" on public.session_participants;
create policy "anon_session_participants_select_by_jwt"
  on public.session_participants
  for select
  to anon
  using (session_id = NULLIF((auth.jwt() -> 'user_metadata' ->> 'session_id'), '')::bigint);

drop policy if exists "auth_session_participants_select_by_membership" on public.session_participants;
create policy "auth_session_participants_select_by_membership"
  on public.session_participants
  for select
  to authenticated
  using (public.is_session_member(session_id) or user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 5) 検証スナップショット — 対象4テーブルに anon/authed の素の true ポリシーが
--    残っていないこと、残存ポリシー一覧を確認する。
-- ----------------------------------------------------------------------------
do $$
declare
  bad_count int;
begin
  select count(*) into bad_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('results', 'scoring_prompts', 'participants', 'session_participants')
    and ('anon' = any(roles::text[]) or 'authenticated' = any(roles::text[]) or 'public' = any(roles::text[]))
    and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true');
  raise notice 'Remaining over-broad (true) anon/authed/public policies on target tables: %', bad_count;
end $$;

select
  tablename,
  policyname,
  cmd,
  roles::text as roles,
  left(coalesce(qual, ''), 80) as using_preview,
  left(coalesce(with_check, ''), 80) as with_check_preview
from pg_policies
where schemaname = 'public'
  and tablename in ('results', 'scoring_prompts', 'participants', 'session_participants')
order by tablename, cmd, policyname;
