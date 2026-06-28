-- ============================================================================
-- Migration 1018: organizations の過剰 INSERT(=true) を撤去（過剰ポリシーをゼロに）
-- ============================================================================
-- WHY: 最終監査で機微テーブルに残る唯一の =true が
--      `Authenticated users can create organizations`(authed INSERT WITH CHECK true)。
--      任意の認証ユーザーが直 PostgREST で organizations を挿入できる（孤児 org 量産＝Low）。
-- 安全性: org 作成はすべて service-role 経由（onboarding=supabaseAdmin[1018前提: batch17]、
--      有料=RPC create_organization_with_subscription、Stripe webhook=service-role）。
--      authed クライアントでの org INSERT 経路はアプリに存在しない → このポリシーは未使用。
-- WHAT: 当該 INSERT ポリシーを撤去（置換なし＝org INSERT は service-role のみに）。
-- DBのみ・アプリ無変更・冪等。DEV 先行 → prod。問題時は 1018_rollback.sql。
-- ============================================================================

drop policy if exists "Authenticated users can create organizations" on public.organizations;

-- 検証（authed の INSERT ポリシーが無くなること／=true が残らないこと）
select policyname, cmd, roles::text as roles, with_check
from pg_policies
where schemaname = 'public' and tablename = 'organizations' and cmd = 'INSERT'
order by policyname;
