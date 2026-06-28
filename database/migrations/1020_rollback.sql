-- ============================================================================
-- ROLLBACK for 1020_profiles_drop_email.sql
-- ============================================================================
-- email 列を復活し、auth.users.email から backfill する（緊急時のみ）。
-- ※ 1020 適用後に旧アプリへ戻す必要が生じた場合に使う。冪等。
-- ============================================================================

alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and (p.email is null or p.email <> u.email);
