-- ============================================================================
-- ROLLBACK for 1017_profiles_select_scope.sql
-- ============================================================================
-- スコープ付き SELECT を撤去し、1017 前の over-broad（=true）を復帰（緊急時のみ）。
-- ⚠️ 復帰すると任意の認証ユーザーが全ユーザーの profiles を越境閲覧できる状態に戻る。
-- helper can_view_profile は残す（無害）。冪等。
-- ============================================================================

begin;

drop policy if exists "profiles_select_visible" on public.profiles;

create policy "Allow users to read all profiles"
  on public.profiles for select to authenticated using (true);

commit;
