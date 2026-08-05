-- ============================================================================
-- Migration 1032: subscriptions.organization_id を NULL 許容にする
-- ============================================================================
-- WHY:
--  列が **NOT NULL** なのに、外部キーは **ON DELETE SET NULL** という自己矛盾した定義だった
--  （prod / dev 両方）。そのうえ本番コードは組織との紐付けを外すために null を書く。
--
--    src/lib/server/stripeWebhook/subscription.ts  handleSubscriptionDeleted
--      → 解約時に organization_id = null（毎回の解約で通る経路）
--    src/lib/server/stripeWebhook/checkout.ts      handleOrganizationCheckout
--      → アップグレード時に旧サブスクの organization_id = null
--
--  どちらも NOT NULL 違反で失敗し、RetryableError → 500 → Stripe が3日間再送して
--  全滅する。**解約もアップグレードも DB に反映されない**。
--  さらに ON DELETE SET NULL が働けないため、サブスクリプション行が残っている
--  組織は削除もできない（FK が null を書こうとして同じ違反になる）。
--
--  2026-08-05 のデータ修正（archive/one-time/2026-08-05_fix_saj_org_comped_premium.sql）を
--  実行しようとして初めて表面化した。アプリのユニットテストは Supabase をモックするため、
--  この種の「DB制約とコードの前提のズレ」は実DBに当てないと検出できない。
--
-- WHAT:
--  organization_id を NULL 許容にする。FK の ON DELETE SET NULL とコードの意図に揃える。
--  個人向けサブスクリプション（組織に属さない）を保存できるようにもなる。
--
--  ⚠️ 「1組織1アクティブ契約」の担保は部分一意インデックス
--     subscriptions_organization_active_unique（1029/053）が引き続き行う。
--     NULL は一意制約の対象外なので、切り離された行が複数あっても衝突しない。
--
-- 適用順: **DB 先行**。アプリは既に null を書きにいくため、先に DB を緩める。
-- 適用対象: prod (scoring-system) と dev (tento-development) の**両方**。
-- ============================================================================

BEGIN;

ALTER TABLE public.subscriptions
	ALTER COLUMN organization_id DROP NOT NULL;

COMMENT ON COLUMN public.subscriptions.organization_id IS
	'所属組織。解約・アップグレード時に紐付けを外すため NULL を許容する（FK は ON DELETE SET NULL）。「1組織1アクティブ契約」は部分一意インデックス subscriptions_organization_active_unique が担保する。';

COMMIT;

-- ============================================================================
-- 確認
--   select is_nullable from information_schema.columns
--   where table_schema='public' and table_name='subscriptions' and column_name='organization_id';
--   -- 期待: YES
-- ============================================================================
