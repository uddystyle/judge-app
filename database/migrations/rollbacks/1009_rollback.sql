-- ============================================================================
-- ROLLBACK for 1009_results_owner_add.sql
-- ============================================================================
-- owner 列と関連索引/制約を撤去して 1009 適用前の状態へ戻す。
-- ⚠️ 1010 を適用済みの場合は先に 1010_rollback.sql を実行すること
--    （1010 で旧 name-unique を撤去・RLS を owner 基準にしているため、先に戻す必要がある）。
-- 冪等。データ列の DROP を含むため、owner のバックフィル値は失われる（再適用で再生成可能）。
-- ============================================================================

drop index if exists public.results_unique_owner_auth;
drop index if exists public.results_unique_owner_guest;

alter table public.results drop constraint if exists results_owner_at_most_one;
alter table public.results drop constraint if exists results_judge_id_fkey;

alter table public.results drop column if exists judge_id;
alter table public.results drop column if exists guest_identifier;
