-- ============================================================================
-- Migration 1029: subscriptions.status の CHECK を Stripe の実ステータスへ揃える
--                 ＋ prod/dev の CHECK ドリフト解消
-- ============================================================================
-- WHY:
--  (1) webhook は Stripe から届いた `subscription.status` を**変換せずそのまま**
--      `subscriptions.status` に書き込む（stripeWebhook/checkout.ts, subscription.ts）。
--      しかし CHECK 制約が Stripe の全ステータスを網羅しておらず、しかも prod と dev で
--      **許可する値が食い違っていた**（2026-08-04 実測）:
--        prod: active, canceled, past_due, unpaid          → incomplete / trialing が入らない
--        dev : active, past_due, canceled, incomplete, trialing → unpaid が入らない
--      欠落値が来ると CHECK 違反 → RetryableError → 500 → Stripe が3日間再送し続ける。
--      決済は成立しているのにサブスクリプションが保存されない状態になる。
--  (2) とくに `stripeWebhook/checkout.ts` の SEC-1b は「新サブスクが incomplete
--      （決済未確定）のことがある」前提で分岐しているのに、**prod ではその値を保存できない**。
--  (3) prod の部分一意インデックス `subscriptions_organization_active_unique` は
--      `WHERE status IN ('active','trialing')` と trialing を参照するが、同テーブルの
--      CHECK が trialing を禁止しており、**条件が原理的に成立しない**矛盾状態だった。
--  (4) さらに prod にだけ `subscriptions_plan_type_check` / `subscriptions_billing_interval_check`
--      が存在し、dev には無いというドリフトもある（dev では不正値が素通りする）。
-- WHAT:
--  - `subscriptions_status_check` を **Stripe の全ステータス**を許可する定義へ張り替える。
--  - dev に欠けている plan_type / billing_interval の CHECK を prod と同じ定義で追加する。
--  - 冪等: DROP IF EXISTS → ADD。再実行しても同じ状態に収束する。
--
-- 対象ステータス（Stripe API 2025-10-29.clover の Subscription.status 全値）:
--   incomplete / incomplete_expired / trialing / active / past_due / canceled / unpaid / paused
--
-- 適用順: **DB 先行**。アプリ側は既にこれらの値を書きにいくため、先に DB を広げる。
-- 適用対象: prod (scoring-system) と dev (tento-development) の**両方**。
--           片側だけの適用はドリフトの再生産になる（本マイグレーションが解消しようとしている当のもの）。
--
-- 事前確認（2026-08-04 実測・両DBとも既存データは新CHECKに適合）:
--   prod subscriptions.status = {active:1, canceled:1} / plan_type = {free:1, basic:1}
--   dev  subscriptions.status = {active:1}             / plan_type = {premium:1}
--   両DBとも billing_interval = {month:1}
--   → ADD CONSTRAINT が既存行で失敗することはない。
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. status: Stripe の全ステータスを許可する
-- ----------------------------------------------------------------------------
ALTER TABLE public.subscriptions
	DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE public.subscriptions
	ADD CONSTRAINT subscriptions_status_check CHECK (
		status IN (
			'incomplete',
			'incomplete_expired',
			'trialing',
			'active',
			'past_due',
			'canceled',
			'unpaid',
			'paused'
		)
	);

COMMENT ON CONSTRAINT subscriptions_status_check ON public.subscriptions IS
	'Stripe Subscription.status の全値。webhook は Stripe の値をそのまま保存するため、Stripe 側に新ステータスが増えたらここも広げること（狭いと CHECK 違反で webhook が 500 を返し続ける）。';

-- ----------------------------------------------------------------------------
-- 2. plan_type: prod にのみ存在した CHECK を dev にも入れる（prod では no-op）
--    'pro' は含めない。旧個人proの契約は存在せず、アプリ側も 2026-08-04 に廃止済み
--    （src/lib/server/plans.ts の findPlanTypeByPriceId）。plan_limits にも pro 行は無い。
-- ----------------------------------------------------------------------------
ALTER TABLE public.subscriptions
	DROP CONSTRAINT IF EXISTS subscriptions_plan_type_check;

ALTER TABLE public.subscriptions
	ADD CONSTRAINT subscriptions_plan_type_check CHECK (
		plan_type IN ('free', 'basic', 'standard', 'premium')
	);

-- ----------------------------------------------------------------------------
-- 3. billing_interval: prod にのみ存在した CHECK を dev にも入れる（prod では no-op）
-- ----------------------------------------------------------------------------
ALTER TABLE public.subscriptions
	DROP CONSTRAINT IF EXISTS subscriptions_billing_interval_check;

ALTER TABLE public.subscriptions
	ADD CONSTRAINT subscriptions_billing_interval_check CHECK (
		billing_interval IN ('month', 'year')
	);

COMMIT;

-- ============================================================================
-- 完了後の確認は verify/1029_verify_status_check.sql を実行すること。
-- ============================================================================
