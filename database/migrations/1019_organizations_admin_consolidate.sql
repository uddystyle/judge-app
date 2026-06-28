-- ============================================================================
-- Migration 1019: organizations の admin UPDATE/DELETE を removed_at 込みに一本化
-- ============================================================================
-- WHY: 020 由来の inline admin ポリシー（`Admins can update their organization` /
--      `Organization admins can update their organization` / `Admins can delete their organization`）は
--      role='admin' のみで `removed_at IS NULL` を見ないため、**ソフト削除済みの元 admin が
--      同 org を改変/削除できる**（越境ではないが認可の緩み・Low）。
-- WHAT: 1013 の `authed_organizations_{update,delete}_by_admin`（= is_organization_admin、
--       role='admin' かつ removed_at IS NULL）が既にあるので、冗長な inline ポリシーを撤去し一本化。
--       active な admin は 1013 で引き続き UPDATE/DELETE 可。soft-removed admin は不可になる。
-- DBのみ・アプリ無変更・冪等。DEV 先行 → prod。問題時は 1019_rollback.sql。
-- ============================================================================

begin;

drop policy if exists "Admins can update their organization" on public.organizations;
drop policy if exists "Organization admins can update their organization" on public.organizations;
drop policy if exists "Admins can delete their organization" on public.organizations;

commit;

-- 検証（UPDATE/DELETE が is_organization_admin ベースのみ＝removed_at 込みに揃うこと）
select policyname, cmd, roles::text as roles, left(coalesce(qual, ''), 100) as using_expr
from pg_policies
where schemaname = 'public' and tablename = 'organizations' and cmd in ('UPDATE', 'DELETE')
order by cmd, policyname;
