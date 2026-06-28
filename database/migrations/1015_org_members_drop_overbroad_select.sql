-- ============================================================================
-- Migration 1015: organization_members の過剰 SELECT (=true) を撤去
-- ============================================================================
-- WHY: prod/dev は `select_all_memberships`(authed SELECT USING true, migration 016)
--      が残存 → 任意の認証ユーザーが全組織の所属（誰がどの org に居るか）を越境列挙できる。
-- WHAT: `select_all_memberships` を撤去するだけ。適切な scoped SELECT は既に存在する:
--   - `Users can view own memberships` / `Users can view their own memberships`  (user_id = auth.uid())
--   - `Members can view active org members`     (is_organization_member, SECURITY DEFINER)
--   - `Members can view organization members`   (get_user_organization_ids, SECURITY DEFINER)
--   - `Admins can view org members` / `Admins can view removed members` (is_organization_admin)
--   いずれも SECURITY DEFINER ヘルパー or 自分自身参照のみ＝**自己参照の再帰ポリシーは無い**ので、
--   `select_all_memberships` を外しても再帰しない・正規の読み取りは維持される。
-- NOTE: アプリの org_members 読み取りは全て own / 同一 org member / admin の範囲（invite は service-role）。
-- DBのみ・アプリ無変更・冪等。DEV 先行 → prod。問題時は 1015_rollback.sql。
-- ============================================================================

begin;

drop policy if exists "select_all_memberships" on public.organization_members;

commit;

-- 検証（=true が無く、scoped のみになること）
select policyname, cmd, roles::text as roles,
       left(coalesce(qual, ''), 120) as using_expr
from pg_policies
where schemaname = 'public' and tablename = 'organization_members'
order by cmd, policyname;
