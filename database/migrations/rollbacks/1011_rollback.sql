-- ============================================================================
-- ROLLBACK for 1011_sessions_fk_owner_delete.sql
-- ============================================================================
-- 1011 が設定した SET NULL FK を撤去し、prod の元挙動へ戻す:
--   - chief_judge_id: FK 無し（1011 前の状態）
--   - created_by: auth.users ON DELETE CASCADE（prod の元挙動）
-- ※ dev の旧挙動（created_by -> profiles NO ACTION）は厳密には復元しない（rollback は prod 基準）。
-- ※ 1011 のクリーンアップ（ダングリング→NULL）はデータ変更のため戻せない（無害）。
-- 冪等。
-- ============================================================================

begin;

alter table public.sessions drop constraint if exists sessions_chief_judge_id_fkey;

alter table public.sessions drop constraint if exists sessions_created_by_fkey;
alter table public.sessions
  add constraint sessions_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete cascade;

commit;
