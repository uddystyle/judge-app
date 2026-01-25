-- ============================================================
-- Migration 053: subscriptionsテーブルのUNIQUE制約を修正
-- ============================================================
-- 実行日: 2026-01-21
-- 説明: stripe_customer_idのUNIQUE制約を削除し、適切な制約に変更
--       これにより、1人のユーザーが複数の組織でサブスクリプションを持てるようになる
-- ============================================================

-- ============================================================
-- 問題の説明
-- ============================================================
-- 現状: stripe_customer_idにUNIQUE制約がある
-- 問題: 1人のユーザー（1つのStripe Customer）が複数の組織でサブスクリプションを持てない
--
-- 例:
--   ユーザーA（stripe_customer_id: cus_xxx）が組織Xのサブスクリプション作成 ✓
--   同じユーザーAが組織Yのサブスクリプション作成を試みる
--   → stripe_customer_idが重複してエラー ✗
-- ============================================================

-- ============================================================
-- 1. stripe_customer_idのUNIQUE制約を削除
-- ============================================================

-- この制約により、1人のユーザーが複数の組織でサブスクリプションを持つことができなかった
ALTER TABLE subscriptions
DROP CONSTRAINT IF EXISTS subscriptions_stripe_customer_id_key;

-- ============================================================
-- 2. stripe_subscription_idにUNIQUE制約を追加
-- ============================================================

-- stripe_subscription_idこそが真にユニークであるべき
-- 1つのStripeサブスクリプションは1つのレコードに対応する
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_unique
ON subscriptions(stripe_subscription_id)
WHERE stripe_subscription_id IS NOT NULL;

-- ============================================================
-- 3. organization_idベースのUNIQUE制約を追加
-- ============================================================

-- 1つの組織は1つのアクティブなサブスクリプションのみを持つべき
-- 部分的UNIQUE INDEX を使用して、activeまたはtrialingステータスのサブスクリプションのみに制約を適用
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_organization_active_unique
ON subscriptions(organization_id)
WHERE status IN ('active', 'trialing');

-- ============================================================
-- 4. stripe_customer_idのインデックスを追加（検索用）
-- ============================================================

-- UNIQUE制約は削除したが、検索性能のためにインデックスは保持
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id
ON subscriptions(stripe_customer_id);

-- ============================================================
-- 5. コメント追加
-- ============================================================

COMMENT ON INDEX subscriptions_stripe_subscription_id_unique IS
'1つのStripeサブスクリプションは1つのレコードにのみ対応する。';

COMMENT ON INDEX subscriptions_organization_active_unique IS
'1つの組織は1つのアクティブなサブスクリプション（active または trialing）のみを持つことができる。キャンセル済みや期限切れのサブスクリプションは複数持てる。';

COMMENT ON INDEX idx_subscriptions_stripe_customer_id IS
'stripe_customer_idでの検索を高速化。1つのCustomerは複数のサブスクリプション（複数の組織）を持てる。';

-- ============================================================
-- 完了
-- ============================================================
-- マイグレーション完了！
-- これで1人のユーザーが複数の組織でサブスクリプションを持てるようになりました。
--
-- 変更内容:
-- - stripe_customer_id: UNIQUE制約削除（同じCustomerが複数組織でサブスクリプション可）
-- - stripe_subscription_id: UNIQUE制約追加（真のユニークキー）
-- - organization_id: 部分的UNIQUE制約（1組織1アクティブサブスクリプション）
-- ============================================================
