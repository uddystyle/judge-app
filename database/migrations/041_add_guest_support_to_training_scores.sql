-- Migration: Add guest user support to training_scores table
-- Description: 研修モードにゲストユーザー機能を追加するため、training_scoresテーブルを拡張
-- Date: 2025-11-13

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Adding guest user support to training_scores table';
  RAISE NOTICE '=================================================================';
END $$;

-- ====================================================================
-- Step 1: スキーマ変更
-- ====================================================================

-- 1-1. judge_idをnullable化（ゲストユーザーはUUIDを持たない）
DO $$
BEGIN
  RAISE NOTICE 'Step 1-1: Making judge_id nullable...';
END $$;

ALTER TABLE training_scores ALTER COLUMN judge_id DROP NOT NULL;

DO $$
BEGIN
  RAISE NOTICE '✓ judge_id is now nullable';
END $$;

-- 1-2. guest_identifier カラムを追加
DO $$
BEGIN
  RAISE NOTICE 'Step 1-2: Adding guest_identifier column...';
END $$;

ALTER TABLE training_scores ADD COLUMN IF NOT EXISTS guest_identifier TEXT;

DO $$
BEGIN
  RAISE NOTICE '✓ guest_identifier column added';
END $$;

-- ====================================================================
-- Step 2: データ整合性制約
-- ====================================================================

-- 2-1. CHECK制約: judge_id または guest_identifier のどちらか一方が必須
DO $$
BEGIN
  RAISE NOTICE 'Step 2-1: Adding check constraint for judge_id or guest_identifier...';
END $$;

ALTER TABLE training_scores ADD CONSTRAINT check_judge_or_guest
  CHECK (
    (judge_id IS NOT NULL AND guest_identifier IS NULL) OR
    (judge_id IS NULL AND guest_identifier IS NOT NULL)
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Check constraint added: exactly one of judge_id or guest_identifier must be set';
END $$;

-- ====================================================================
-- Step 3: ユニーク制約の再作成
-- ====================================================================

-- 3-1. 既存のユニーク制約を削除（本番環境のみ存在）
DO $$
BEGIN
  RAISE NOTICE 'Step 3-1: Dropping existing unique constraint...';
END $$;

ALTER TABLE training_scores DROP CONSTRAINT IF EXISTS unique_training_score;

DO $$
BEGIN
  RAISE NOTICE '✓ Existing unique_training_score constraint dropped (if existed)';
END $$;

-- 3-2. 認証ユーザー用の部分ユニークインデックス
DO $$
BEGIN
  RAISE NOTICE 'Step 3-2: Creating unique index for authenticated users...';
END $$;

CREATE UNIQUE INDEX idx_training_scores_unique_auth
  ON training_scores(event_id, judge_id, athlete_id)
  WHERE judge_id IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE '✓ Unique index for authenticated users created';
  RAISE NOTICE '  Index: idx_training_scores_unique_auth (event_id, judge_id, athlete_id)';
END $$;

-- 3-3. ゲストユーザー用の部分ユニークインデックス
DO $$
BEGIN
  RAISE NOTICE 'Step 3-3: Creating unique index for guest users...';
END $$;

CREATE UNIQUE INDEX idx_training_scores_unique_guest
  ON training_scores(event_id, guest_identifier, athlete_id)
  WHERE guest_identifier IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE '✓ Unique index for guest users created';
  RAISE NOTICE '  Index: idx_training_scores_unique_guest (event_id, guest_identifier, athlete_id)';
END $$;

-- ====================================================================
-- Step 4: パフォーマンスインデックスの追加
-- ====================================================================

DO $$
BEGIN
  RAISE NOTICE 'Step 4: Adding performance indexes...';
END $$;

-- 4-1. 既存インデックス（本番環境には存在、開発環境には不足）
CREATE INDEX IF NOT EXISTS idx_training_scores_event ON training_scores(event_id);
CREATE INDEX IF NOT EXISTS idx_training_scores_judge ON training_scores(judge_id);
CREATE INDEX IF NOT EXISTS idx_training_scores_athlete ON training_scores(athlete_id);
CREATE INDEX IF NOT EXISTS idx_training_scores_finalized ON training_scores(is_finalized);

DO $$
BEGIN
  RAISE NOTICE '✓ Performance indexes verified/created:';
  RAISE NOTICE '  - idx_training_scores_event';
  RAISE NOTICE '  - idx_training_scores_judge';
  RAISE NOTICE '  - idx_training_scores_athlete';
  RAISE NOTICE '  - idx_training_scores_finalized';
END $$;

-- 4-2. ゲストユーザー用の新しいインデックス
CREATE INDEX idx_training_scores_guest_identifier
  ON training_scores(guest_identifier)
  WHERE guest_identifier IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE '✓ Guest identifier index created:';
  RAISE NOTICE '  - idx_training_scores_guest_identifier';
END $$;

-- ====================================================================
-- Step 5: 確認クエリ
-- ====================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Verification queries:';
  RAISE NOTICE '=================================================================';
END $$;

-- カラム確認
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'training_scores'
  AND column_name IN ('judge_id', 'guest_identifier')
ORDER BY column_name;

-- 制約確認
SELECT
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'training_scores'
  AND con.contype = 'c'
ORDER BY con.conname;

-- インデックス確認
SELECT
  i.relname AS index_name,
  ix.indisunique AS is_unique,
  pg_get_indexdef(ix.indexrelid) AS index_definition
FROM pg_class t
JOIN pg_index ix ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
WHERE t.relname = 'training_scores'
  AND i.relname LIKE '%training_scores%'
ORDER BY i.relname;

-- ====================================================================
-- 完了メッセージ
-- ====================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 041_add_guest_support_to_training_scores.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Changes applied:';
  RAISE NOTICE '- judge_id is now nullable';
  RAISE NOTICE '- guest_identifier column added';
  RAISE NOTICE '- Check constraint ensures exactly one identifier is present';
  RAISE NOTICE '- Unique constraints recreated as partial indexes';
  RAISE NOTICE '- Performance indexes verified/added';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Run Migration 042 to update RLS policies';
  RAISE NOTICE '2. Update application code to handle guest_identifier';
  RAISE NOTICE '3. Test guest user scoring workflow';
  RAISE NOTICE '=================================================================';
END $$;
