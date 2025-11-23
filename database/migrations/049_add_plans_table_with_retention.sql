-- ============================================================
-- Migration 049: プランテーブルとアーカイブデータ保持期間の追加
-- ============================================================
-- 実行日: 2025-11-23
-- 説明: プラン別のアーカイブデータ保持期間を管理するplansテーブルを作成
-- ============================================================

-- ============================================================
-- 1. plans テーブルの作成
-- ============================================================

CREATE TABLE IF NOT EXISTS plans (
  plan_type TEXT PRIMARY KEY CHECK (plan_type IN ('free', 'basic', 'standard', 'premium')),

  -- アーカイブデータ保持期間（日数）
  -- -1 = 無制限（Premiumプラン）
  archived_data_retention_days INTEGER NOT NULL,

  -- タイムスタンプ
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. プラン別保持期間の初期データ投入
-- ============================================================

INSERT INTO plans (plan_type, archived_data_retention_days) VALUES
  ('free', 30),      -- フリー: 30日間保持
  ('basic', 90),     -- Basic: 90日間保持
  ('standard', 180), -- Standard: 180日間保持
  ('premium', -1)    -- Premium: 無期限保持
ON CONFLICT (plan_type) DO UPDATE SET
  archived_data_retention_days = EXCLUDED.archived_data_retention_days;

-- ============================================================
-- 3. updated_at自動更新関数とトリガー
-- ============================================================

-- 関数が存在しない場合は作成
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガーの作成
DROP TRIGGER IF EXISTS update_plans_updated_at ON plans;
CREATE TRIGGER update_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 4. RLS設定
-- ============================================================

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- 誰でもプラン情報を閲覧可能（料金ページなどでの表示用）
CREATE POLICY "Anyone can view plans"
  ON plans FOR SELECT
  TO authenticated
  USING (true);

-- 匿名ユーザーもプラン情報を閲覧可能（料金ページ用）
CREATE POLICY "Anonymous users can view plans"
  ON plans FOR SELECT
  TO anon
  USING (true);

-- ============================================================
-- 5. インデックス
-- ============================================================

-- plan_typeがPRIMARY KEYなので追加のインデックスは不要

-- ============================================================
-- 完了
-- ============================================================
-- マイグレーション完了！
-- 次のステップ: 自動削除関数の作成
-- ============================================================
