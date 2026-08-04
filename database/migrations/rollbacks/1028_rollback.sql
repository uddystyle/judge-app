-- ============================================================================
-- Rollback for Migration 1028
-- ============================================================================
-- 緊急時のみ。撤回すると:
--  - 主任検定員のセットアップ操作（参加者・研修種目の追加/更新/削除）が RLS で
--    0 行になる。アプリは影響行数を見て明示的なエラーを出すため、黙って失敗する
--    ことはないが、主任は操作できなくなる（作成者のみ可）。
--  - participants の participation ベース INSERT が全モードに戻り、セッション参加者なら
--    誰でも公開 API から選手を差し込める状態に戻る。
-- 冪等。
-- ============================================================================

begin;

drop policy if exists "authed_participants_insert_by_manager"     on public.participants;
drop policy if exists "authed_participants_update_by_manager"     on public.participants;
drop policy if exists "authed_participants_delete_by_manager"     on public.participants;
drop policy if exists "authed_training_events_insert_by_manager"  on public.training_events;
drop policy if exists "authed_training_events_update_by_manager"  on public.training_events;
drop policy if exists "authed_training_events_delete_by_manager"  on public.training_events;

-- participation ベース INSERT を 1007 の定義（モード限定なし）へ戻す
drop policy if exists "auth_participants_insert_by_participation" on public.participants;
create policy "auth_participants_insert_by_participation"
  on public.participants for insert to authenticated
  with check (
    session_id in (
      select session_participants.session_id
      from public.session_participants
      where session_participants.user_id = auth.uid()
    )
  );

drop function if exists public.is_session_manager(bigint);

commit;
