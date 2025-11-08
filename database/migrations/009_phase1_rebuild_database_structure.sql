-- ============================================================
-- Phase 1: データベース構造の再構築
-- ============================================================
-- 完全に組織ベースの設計に移行します
-- ============================================================
-- 実行日: 2025-11-07
-- 説明: 組織ベース設計への完全移行
-- ============================================================

-- ============================================================
-- 1-1. organizations テーブルの修正
-- ============================================================

-- plan_typeの制約を更新（free, basic, standard, premiumのみ）
ALTER TABLE organizations
DROP CONSTRAINT IF EXISTS organizations_plan_type_check;

ALTER TABLE organizations
ADD CONSTRAINT organizations_plan_type_check
CHECK (plan_type IN ('free', 'basic', 'standard', 'premium'));

-- ============================================================
-- 1-2. sessions テーブルの修正
-- ============================================================

-- organization_idをNOT NULLに変更
-- まず既存のNULLデータがないことを確認
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM sessions WHERE organization_id IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION 'sessions テーブルに organization_id が NULL のレコードが % 件存在します。先に Phase 0 を実行してデータをクリーンアップしてください。', null_count;
  END IF;
END $$;

-- organization_idをNOT NULLに変更
ALTER TABLE sessions
ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- 1-3. plan_limits テーブルの拡張
-- ============================================================

-- 新しいカラムを追加
ALTER TABLE plan_limits
ADD COLUMN IF NOT EXISTS max_organization_members INTEGER NOT NULL DEFAULT -1,
ADD COLUMN IF NOT EXISTS max_judges_per_session INTEGER NOT NULL DEFAULT -1;

-- ============================================================
-- 1-4. plan_limits テーブルのデータ更新
-- ============================================================

-- フリープラン（無料）
INSERT INTO plan_limits (
  plan_type,
  max_sessions_per_month,
  max_athletes_per_session,
  max_judges_per_session,
  max_organization_members,
  has_tournament_mode,
  has_training_mode,
  has_scoreboard,
  data_retention_months
) VALUES (
  'free',
  3,           -- 月3セッション
  -1,          -- 選手数無制限
  3,           -- 検定員3人まで
  1,           -- 組織メンバー1人
  false,       -- 大会モードなし
  false,       -- 研修モードなし
  false,       -- スコアボードなし
  3            -- データ保持3ヶ月
)
ON CONFLICT (plan_type) DO UPDATE SET
  max_sessions_per_month = EXCLUDED.max_sessions_per_month,
  max_judges_per_session = EXCLUDED.max_judges_per_session,
  max_organization_members = EXCLUDED.max_organization_members,
  has_tournament_mode = EXCLUDED.has_tournament_mode,
  has_training_mode = EXCLUDED.has_training_mode,
  has_scoreboard = EXCLUDED.has_scoreboard,
  data_retention_months = EXCLUDED.data_retention_months;

-- Basicプラン（¥8,800/月）
INSERT INTO plan_limits (
  plan_type,
  max_sessions_per_month,
  max_athletes_per_session,
  max_judges_per_session,
  max_organization_members,
  has_tournament_mode,
  has_training_mode,
  has_scoreboard,
  data_retention_months
) VALUES (
  'basic',
  -1,          -- 無制限
  -1,          -- 選手数無制限
  15,          -- 検定員15人まで
  10,          -- 組織メンバー10人
  true,        -- 大会モードあり
  true,        -- 研修モードあり（最大20人）
  true,        -- スコアボードあり
  12           -- データ保持12ヶ月
)
ON CONFLICT (plan_type) DO UPDATE SET
  max_sessions_per_month = EXCLUDED.max_sessions_per_month,
  max_judges_per_session = EXCLUDED.max_judges_per_session,
  max_organization_members = EXCLUDED.max_organization_members,
  has_tournament_mode = EXCLUDED.has_tournament_mode,
  has_training_mode = EXCLUDED.has_training_mode,
  has_scoreboard = EXCLUDED.has_scoreboard,
  data_retention_months = EXCLUDED.data_retention_months;

-- Standardプラン（¥24,800/月）
INSERT INTO plan_limits (
  plan_type,
  max_sessions_per_month,
  max_athletes_per_session,
  max_judges_per_session,
  max_organization_members,
  has_tournament_mode,
  has_training_mode,
  has_scoreboard,
  data_retention_months
) VALUES (
  'standard',
  -1,          -- 無制限
  -1,          -- 選手数無制限
  50,          -- 検定員50人まで
  30,          -- 組織メンバー30人
  true,        -- 大会モードあり
  true,        -- 研修モードあり（最大50人）
  true,        -- スコアボードあり
  24           -- データ保持24ヶ月
)
ON CONFLICT (plan_type) DO UPDATE SET
  max_sessions_per_month = EXCLUDED.max_sessions_per_month,
  max_judges_per_session = EXCLUDED.max_judges_per_session,
  max_organization_members = EXCLUDED.max_organization_members,
  has_tournament_mode = EXCLUDED.has_tournament_mode,
  has_training_mode = EXCLUDED.has_training_mode,
  has_scoreboard = EXCLUDED.has_scoreboard,
  data_retention_months = EXCLUDED.data_retention_months;

-- Premiumプラン（¥49,800/月 - 最上位）
INSERT INTO plan_limits (
  plan_type,
  max_sessions_per_month,
  max_athletes_per_session,
  max_judges_per_session,
  max_organization_members,
  has_tournament_mode,
  has_training_mode,
  has_scoreboard,
  data_retention_months
) VALUES (
  'premium',
  -1,          -- 無制限
  -1,          -- 選手数無制限
  100,         -- 検定員100人まで
  100,         -- 組織メンバー100人
  true,        -- 大会モードあり
  true,        -- 研修モードあり（最大100人）
  true,        -- スコアボードあり
  -1           -- データ保持無制限
)
ON CONFLICT (plan_type) DO UPDATE SET
  max_sessions_per_month = EXCLUDED.max_sessions_per_month,
  max_judges_per_session = EXCLUDED.max_judges_per_session,
  max_organization_members = EXCLUDED.max_organization_members,
  has_tournament_mode = EXCLUDED.has_tournament_mode,
  has_training_mode = EXCLUDED.has_training_mode,
  has_scoreboard = EXCLUDED.has_scoreboard,
  data_retention_months = EXCLUDED.data_retention_months;

-- ============================================================
-- 1-5. subscriptions テーブルの修正
-- ============================================================

-- organization_idをNOT NULLに変更
-- まず既存のNULLデータがないことを確認
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM subscriptions WHERE organization_id IS NULL;

  IF null_count > 0 THEN
    RAISE NOTICE 'subscriptions テーブルに organization_id が NULL のレコードが % 件存在します。', null_count;
    -- サブスクリプションデータは削除しても問題ないため、警告のみ
  END IF;
END $$;

-- NULLデータを削除
DELETE FROM subscriptions WHERE organization_id IS NULL;

-- organization_idをNOT NULLに変更
ALTER TABLE subscriptions
ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- 完了
-- ============================================================
-- データベース構造の再構築が完了しました。
-- 次のステップ: Phase 2（初回登録フローの実装）を進めてください。
-- ============================================================
