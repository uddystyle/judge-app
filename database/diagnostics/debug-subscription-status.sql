-- ============================================================
-- サブスクリプション状態確認クエリ
-- 使い方: YOUR_EMAIL@example.com を自分のメールアドレスに置き換えて実行
-- ============================================================

-- クエリ1: 個人サブスクリプション状態を確認
SELECT
    s.id,
    s.plan_type,
    s.status,
    s.stripe_subscription_id,
    s.organization_id,
    s.cancel_at_period_end,
    s.current_period_end,
    s.updated_at,
    u.email
FROM subscriptions s
INNER JOIN auth.users u ON s.user_id = u.id
WHERE u.email = 'YOUR_EMAIL@example.com';

-- クエリ2: 組織プラン状態を確認
SELECT
    o.id AS org_id,
    o.name AS org_name,
    o.plan_type,
    o.stripe_subscription_id,
    o.max_members,
    o.updated_at,
    u.email
FROM organizations o
INNER JOIN organization_members om ON o.id = om.organization_id
INNER JOIN auth.users u ON om.user_id = u.id
WHERE u.email = 'YOUR_EMAIL@example.com'
  AND om.removed_at IS NULL;
