-- ============================================================================
-- Rollback for Migration 1027
-- ============================================================================
-- 緊急時のみ。撤回すると:
--  - 「修正を要求」フローが再び機能しなくなる（training_scores に authenticated の
--    DELETE ポリシーが無くなり、主任でも認証審判の研修採点を削除できない。
--    アプリ側は 0 行削除をエラーとして扱うため、黙って成功する代わりに
--    明示的なエラーになる）。
--  - training_sessions の anon SELECT が復活し、ゲストが1人でも居るセッションの
--    研修設定が anon キーだけで読める状態に戻る（表示設定のみで PII は無い）。
-- 冪等。
-- ============================================================================

begin;

drop policy if exists "auth_results_delete_by_owner"          on public.results;
drop policy if exists "guest_results_delete_by_owner"         on public.results;
drop policy if exists "auth_training_scores_delete_by_owner"  on public.training_scores;
drop policy if exists "chief_training_scores_delete"          on public.training_scores;

create policy "Anonymous users can view training sessions"
  on public.training_sessions for select to anon
  using (
    session_id in (
      select session_participants.session_id
      from public.session_participants
      where session_participants.is_guest = true
    )
  );

commit;
