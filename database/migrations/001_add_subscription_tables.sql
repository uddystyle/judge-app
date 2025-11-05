-- ============================================================
-- TENTO Subscription Tables Migration
-- ============================================================
-- このファイルをSupabase SQL Editorで実行してください
-- ============================================================

-- ============================================================
-- 1. subscriptions テーブル
-- ============================================================
-- ユーザーのサブスクリプション情報を管理

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Stripe関連
  stripe_customer_id TEXT UNIQUE NOT NULL,
  stripe_subscription_id TEXT UNIQUE,

  -- プラン情報
  plan_type TEXT NOT NULL CHECK (plan_type IN ('free', 'standard', 'pro')),
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('month', 'year')),

  -- ステータス
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'unpaid')),

  -- 期間
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,

  -- タイムスタンプ
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id)
);

-- RLS設定
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);

-- ============================================================
-- 2. plan_limits テーブル
-- ============================================================
-- 各プランの制限値を定義

CREATE TABLE IF NOT EXISTS plan_limits (
  plan_type TEXT PRIMARY KEY,
  max_sessions_per_month INTEGER, -- -1 = unlimited
  max_athletes_per_session INTEGER, -- -1 = unlimited
  max_judges_per_session INTEGER, -- -1 = unlimited
  has_tournament_mode BOOLEAN DEFAULT FALSE,
  has_training_mode BOOLEAN DEFAULT FALSE,
  has_scoreboard BOOLEAN DEFAULT FALSE,
  data_retention_months INTEGER -- -1 = unlimited
);

-- 初期データ投入
INSERT INTO plan_limits VALUES
  ('free', 3, 30, 5, false, false, false, 3),
  ('standard', -1, 100, 20, true, true, true, 12),
  ('pro', -1, -1, -1, true, true, true, -1)
ON CONFLICT (plan_type) DO NOTHING;

-- ============================================================
-- 3. usage_limits テーブル
-- ============================================================
-- 月ごとの使用状況を追跡

CREATE TABLE IF NOT EXISTS usage_limits (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  month DATE NOT NULL, -- 'YYYY-MM-01' 形式
  sessions_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month)
);

-- RLS設定
ALTER TABLE usage_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage"
  ON usage_limits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own usage"
  ON usage_limits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own usage"
  ON usage_limits FOR UPDATE
  USING (auth.uid() = user_id);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_usage_limits_user_id_month ON usage_limits(user_id, month);

-- ============================================================
-- 4. updated_at自動更新トリガー
-- ============================================================

-- トリガー関数（存在しない場合のみ作成）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- subscriptions テーブル用トリガー
DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- usage_limits テーブル用トリガー
DROP TRIGGER IF EXISTS update_usage_limits_updated_at ON usage_limits;
CREATE TRIGGER update_usage_limits_updated_at
  BEFORE UPDATE ON usage_limits
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 完了
-- ============================================================
-- マイグレーション完了しました！
-- 次のステップ: Stripe APIエンドポイントの実装
-- ============================================================
