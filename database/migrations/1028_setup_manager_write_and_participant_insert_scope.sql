-- ============================================================================
-- Migration 1028: セットアップ書込みを「作成者 or 主任」に揃える ＋ participants INSERT の対象限定
-- ============================================================================
-- WHY:
--  (1) セットアップ画面（tournament-setup / training-setup）は load の
--      `authorizeSetupAccess` が **作成者 または 主任** を通す設計で、アクション側にも
--      同じガードを入れた（1027 と同時のアプリ変更）。しかし RLS 側は
--      `participants` / `training_events` の書込みが `is_session_creator` **のみ**で、
--      主任が操作すると**アプリは通るのに DB で 0 行**になる。しかも更新・削除は影響
--      行数を見ていなかったため、何も起きていないのに成功が返っていた。
--      特に importCSV は「全 delete → insert」なので、delete が 0 行のまま insert へ
--      進むと名簿の重複・混在を招く。
--  (2) `auth_participants_insert_by_participation`（1007）は「セッション参加者なら誰でも
--      participants を INSERT できる」。これは**検定モードの未登録ゼッケン自動作成**
--      （scoreSync.ts の ensureParticipantExists。ユーザークライアントで INSERT する）
--      を支える現役の依存だが、大会・研修は名簿をセットアップ画面で作る運用であり、
--      参加者が公開 API を直接叩いて選手を差し込めるのは広すぎる。
-- WHAT:
--  (1) `is_session_manager(session_id)`（作成者 or 主任）を追加し、participants /
--      training_events に **manager 版の INSERT/UPDATE/DELETE を追加**する。
--      既存の creator 限定ポリシーは**残す**（permissive は OR で合成されるため、
--      作成者の権限は変わらない。SELECT を持つ ALL ポリシーを落とさずに済む）。
--  (2) participants の participation ベース INSERT を **検定モードのセッションに限定**。
--      大会・研修では作成者/主任のみが名簿を作れる。
-- 適用順: **DB 先行**（アプリの行数チェック追加より先に入れば、主任の操作が先に
--        正しく通るようになる＝安全側）。
-- 冪等。DEV 先行 → prod。問題時は rollbacks/1028_rollback.sql。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- (0) 作成者 or 主任 を判定するヘルパー
-- ----------------------------------------------------------------------------
-- 既存の is_session_creator / is_session_member と同じ SECURITY DEFINER 方式。
-- search_path を固定し、anon からは実行できないようにする（1025 の作法に合わせる）。
create or replace function public.is_session_manager(p_session_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session_id
      and (s.created_by = auth.uid() or s.chief_judge_id = auth.uid())
  )
$$;

comment on function public.is_session_manager(bigint) is
  'セッションの作成者または主任検定員か。セットアップ画面の load/アクションと同じ判定を RLS 側でも使う。';

revoke all on function public.is_session_manager(bigint) from public;
revoke execute on function public.is_session_manager(bigint) from anon;
grant execute on function public.is_session_manager(bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- (1) セットアップ書込みを主任にも許可（既存の creator 限定ポリシーは残す）
-- ----------------------------------------------------------------------------
drop policy if exists "authed_participants_insert_by_manager" on public.participants;
create policy "authed_participants_insert_by_manager"
  on public.participants for insert to authenticated
  with check (public.is_session_manager(session_id));

drop policy if exists "authed_participants_update_by_manager" on public.participants;
create policy "authed_participants_update_by_manager"
  on public.participants for update to authenticated
  using (public.is_session_manager(session_id))
  with check (public.is_session_manager(session_id));

drop policy if exists "authed_participants_delete_by_manager" on public.participants;
create policy "authed_participants_delete_by_manager"
  on public.participants for delete to authenticated
  using (public.is_session_manager(session_id));

drop policy if exists "authed_training_events_insert_by_manager" on public.training_events;
create policy "authed_training_events_insert_by_manager"
  on public.training_events for insert to authenticated
  with check (public.is_session_manager(session_id));

drop policy if exists "authed_training_events_update_by_manager" on public.training_events;
create policy "authed_training_events_update_by_manager"
  on public.training_events for update to authenticated
  using (public.is_session_manager(session_id))
  with check (public.is_session_manager(session_id));

drop policy if exists "authed_training_events_delete_by_manager" on public.training_events;
create policy "authed_training_events_delete_by_manager"
  on public.training_events for delete to authenticated
  using (public.is_session_manager(session_id));

-- ----------------------------------------------------------------------------
-- (2) participation ベースの participants INSERT を検定モードに限定
-- ----------------------------------------------------------------------------
-- 検定モードだけが「未登録ゼッケンの自動作成」を設計として持つ（大会・研修は
-- participant_not_found / requireRegistered で弾く）。したがってこの緩い INSERT は
-- 検定セッションにのみ必要。mode の既定値は 'certification'。
drop policy if exists "auth_participants_insert_by_participation" on public.participants;
create policy "auth_participants_insert_by_participation"
  on public.participants for insert to authenticated
  with check (
    session_id in (
      select sp.session_id from public.session_participants sp where sp.user_id = auth.uid()
    )
    and exists (
      select 1 from public.sessions s
      where s.id = participants.session_id
        and coalesce(s.mode, 'certification') = 'certification'
        and coalesce(s.is_tournament_mode, false) = false
    )
  );

commit;

-- ============================================================================
-- 検証（適用後に実行）
-- ============================================================================
-- 1) manager 版ポリシーが 6 本そろっていること
-- select tablename, policyname, cmd from pg_policies
--  where schemaname='public' and policyname like 'authed_%_by_manager' order by 1,2;
--
-- 2) participation ベース INSERT が検定モード限定になっていること
-- select with_check from pg_policies
--  where schemaname='public' and policyname='auth_participants_insert_by_participation';
--
-- 3) ヘルパーが anon から実行できないこと（grantee に anon が無い）
-- select grantee, privilege_type from information_schema.routine_privileges
--  where routine_schema='public' and routine_name='is_session_manager' order by grantee;
