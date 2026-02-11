-- Stripe E2E統合テスト: DB状態検証クエリ
-- 使用方法: Supabase SQL Editorまたはpsqlで実行

-- ============================================================
-- 1. 個人課金サブスクリプションの検証
-- ============================================================

-- テストユーザーのサブスクリプション情報を確認
SELECT
  user_id,
  plan_type,
  billing_interval,
  status,
  stripe_customer_id,
  stripe_subscription_id,
  current_period_start,
  current_period_end,
  cancel_at_period_end,
  organization_id,
  created_at,
  updated_at
FROM subscriptions
WHERE user_id = '<TEST_USER_ID>' -- ここにテストユーザーIDを入力
ORDER BY updated_at DESC;

-- 期待される結果（個人課金 Standard プラン）:
-- plan_type = 'standard'
-- billing_interval = 'month' または 'year'
-- status = 'active'
-- stripe_customer_id = 'cus_xxxxx'
-- stripe_subscription_id = 'sub_xxxxx'
-- organization_id = NULL
-- cancel_at_period_end = false

-- ============================================================
-- 2. 組織課金サブスクリプションの検証
-- ============================================================

-- 組織情報を確認
SELECT
  id,
  name,
  plan_type,
  max_members,
  stripe_customer_id,
  stripe_subscription_id,
  created_at,
  updated_at
FROM organizations
WHERE id = '<TEST_ORG_ID>' -- ここにテスト組織IDを入力
ORDER BY updated_at DESC;

-- 期待される結果（組織 Basic プラン）:
-- plan_type = 'basic'
-- max_members = 10
-- stripe_customer_id = 'cus_xxxxx'
-- stripe_subscription_id = 'sub_xxxxx'

-- 組織メンバーシップを確認
SELECT
  om.organization_id,
  om.user_id,
  om.role,
  p.full_name,
  p.email
FROM organization_members om
LEFT JOIN profiles p ON om.user_id = p.id
WHERE om.organization_id = '<TEST_ORG_ID>'
ORDER BY om.joined_at;

-- 期待される結果:
-- 作成者が role = 'admin' で登録されている

-- 組織のサブスクリプション情報を確認
SELECT
  user_id,
  organization_id,
  plan_type,
  billing_interval,
  status,
  stripe_customer_id,
  stripe_subscription_id,
  current_period_start,
  current_period_end
FROM subscriptions
WHERE organization_id = '<TEST_ORG_ID>'
ORDER BY updated_at DESC;

-- 期待される結果:
-- organization_id が設定されている
-- plan_type = 'basic'
-- status = 'active'

-- ============================================================
-- 3. サブスクリプションキャンセル後の検証
-- ============================================================

-- キャンセル後のサブスクリプション状態を確認
SELECT
  user_id,
  plan_type,
  billing_interval,
  status,
  stripe_customer_id,
  stripe_subscription_id,
  cancel_at_period_end,
  organization_id
FROM subscriptions
WHERE user_id = '<TEST_USER_ID>'
  AND status = 'canceled'
ORDER BY updated_at DESC;

-- 期待される結果（キャンセル後）:
-- plan_type = 'free'
-- status = 'canceled'
-- stripe_subscription_id = NULL
-- cancel_at_period_end = NULL

-- ============================================================
-- 4. 全体的なデータ整合性チェック
-- ============================================================

-- 孤立したサブスクリプション（存在しないユーザー）
SELECT s.*
FROM subscriptions s
LEFT JOIN auth.users u ON s.user_id = u.id
WHERE u.id IS NULL;

-- 期待される結果: 0件

-- 孤立した組織サブスクリプション（存在しない組織）
SELECT s.*
FROM subscriptions s
WHERE s.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = s.organization_id
  );

-- 期待される結果: 0件

-- 組織とサブスクリプションのプラン不一致
SELECT
  o.id AS org_id,
  o.name AS org_name,
  o.plan_type AS org_plan_type,
  s.plan_type AS subscription_plan_type,
  o.stripe_subscription_id AS org_stripe_sub_id,
  s.stripe_subscription_id AS sub_stripe_sub_id
FROM organizations o
LEFT JOIN subscriptions s ON o.id = s.organization_id
WHERE o.plan_type != s.plan_type
   OR o.stripe_subscription_id != s.stripe_subscription_id;

-- 期待される結果: 0件（プラン不一致なし）

-- ============================================================
-- 5. Stripe同期状態の確認
-- ============================================================

-- アクティブなサブスクリプション一覧
SELECT
  user_id,
  organization_id,
  plan_type,
  billing_interval,
  status,
  stripe_subscription_id,
  current_period_end
FROM subscriptions
WHERE status = 'active'
  AND stripe_subscription_id IS NOT NULL
ORDER BY current_period_end;

-- これらのstripe_subscription_idをStripe Dashboardで確認し、
-- ステータスがActiveであることを検証してください。

-- ============================================================
-- 6. テストクリーンアップ（オプション）
-- ============================================================

-- テストデータを削除する場合は、以下のクエリを実行
-- 注意: 本番環境では絶対に実行しないでください

-- テストユーザーのサブスクリプションを削除
-- DELETE FROM subscriptions WHERE user_id = '<TEST_USER_ID>';

-- テスト組織のサブスクリプションを削除
-- DELETE FROM subscriptions WHERE organization_id = '<TEST_ORG_ID>';

-- テスト組織のメンバーシップを削除
-- DELETE FROM organization_members WHERE organization_id = '<TEST_ORG_ID>';

-- テスト組織を削除
-- DELETE FROM organizations WHERE id = '<TEST_ORG_ID>';
