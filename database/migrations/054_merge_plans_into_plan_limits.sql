-- ============================================================
-- Migration 054: plansテーブルをplan_limitsテーブルに統合
-- ============================================================
-- 実行日: 2026-01-21
-- 説明: plansテーブルのデータをplan_limitsテーブルに統合し、重複を解消
-- ============================================================

-- ============================================================
-- 問題の説明
-- ============================================================
-- 現状: plan_limitsテーブルとplansテーブルで同じplan_typeをPKとして管理
-- 問題: データが2つのテーブルに分散しており、整合性維持が困難
--
-- plan_limits: プラン機能制限（メンバー数、セッション数など）
-- plans: アーカイブデータ保持期間
--
-- 同じエンティティ（プラン）の情報を別テーブルで管理するのは非効率
-- ============================================================

-- ============================================================
-- 1. plan_limitsテーブルにarchivedデータ保持期間カラムを追加
-- ============================================================

-- archived_data_retention_daysカラムを追加（日数単位）
ALTER TABLE plan_limits
ADD COLUMN IF NOT EXISTS archived_data_retention_days INTEGER NOT NULL DEFAULT 30;

-- ============================================================
-- 2. plansテーブルのデータをplan_limitsに統合
-- ============================================================

-- plansテーブルのデータでplan_limitsを更新
UPDATE plan_limits
SET archived_data_retention_days = plans.archived_data_retention_days
FROM plans
WHERE plan_limits.plan_type = plans.plan_type;

-- ============================================================
-- 3. タイムスタンプカラムを追加（plansテーブルから移行）
-- ============================================================

-- created_atとupdated_atがない場合は追加
ALTER TABLE plan_limits
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================
-- 4. updated_at自動更新トリガーを追加
-- ============================================================

-- トリガーを追加（関数は既に存在する想定）
DROP TRIGGER IF EXISTS update_plan_limits_updated_at ON plan_limits;
CREATE TRIGGER update_plan_limits_updated_at
  BEFORE UPDATE ON plan_limits
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 5. RLS設定（plansテーブルのポリシーをplan_limitsに移行）
-- ============================================================

-- plan_limitsのRLSを有効化（既に有効な場合は何もしない）
ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;

-- 誰でもプラン情報を閲覧可能（料金ページなどでの表示用）
DROP POLICY IF EXISTS "Anyone can view plan_limits" ON plan_limits;
CREATE POLICY "Anyone can view plan_limits"
  ON plan_limits FOR SELECT
  TO authenticated
  USING (true);

-- 匿名ユーザーもプラン情報を閲覧可能（料金ページ用）
DROP POLICY IF EXISTS "Anonymous users can view plan_limits" ON plan_limits;
CREATE POLICY "Anonymous users can view plan_limits"
  ON plan_limits FOR SELECT
  TO anon
  USING (true);

-- ============================================================
-- 6. plansテーブルを削除
-- ============================================================

-- plansテーブルのデータは既にplan_limitsに統合されたため削除
DROP TABLE IF EXISTS plans;

-- ============================================================
-- 7. コメント追加
-- ============================================================

COMMENT ON COLUMN plan_limits.archived_data_retention_days IS
'アーカイブデータの保持期間（日数）。-1は無制限保持を意味する。';

COMMENT ON COLUMN plan_limits.data_retention_months IS
'通常データの保持期間（月数）。-1は無制限保持を意味する。';

-- ============================================================
-- 完了
-- ============================================================
-- マイグレーション完了！
-- plansテーブルのデータはplan_limitsテーブルに統合され、plansテーブルは削除されました。
--
-- 変更内容:
-- - plan_limitsテーブルにarchived_data_retention_daysカラムを追加
-- - plansテーブルのデータをplan_limitsに統合
-- - plansテーブルを削除
-- - plan_limitsにRLSポリシーを追加
-- ============================================================
