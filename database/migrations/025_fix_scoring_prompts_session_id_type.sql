-- Migration: Fix scoring_prompts.session_id Type Mismatch
-- Description: scoring_prompts.session_idをbigintからUUIDに変更して、sessions.idとの型を一致させる
-- Date: 2025-01-12

-- ============================================================
-- 1. 既存データの確認と警告
-- ============================================================

DO $$
DECLARE
  record_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO record_count FROM scoring_prompts;

  IF record_count > 0 THEN
    RAISE NOTICE 'Warning: scoring_prompts table contains % records. These will be deleted during migration.', record_count;
  ELSE
    RAISE NOTICE 'scoring_prompts table is empty. Safe to proceed.';
  END IF;
END $$;

-- ============================================================
-- 2. 外部キー制約を削除
-- ============================================================

ALTER TABLE scoring_prompts
DROP CONSTRAINT IF EXISTS scoring_prompts_session_id_fkey;

-- ============================================================
-- 3. 既存のデータを削除（bigint → UUID変換は不可能なため）
-- ============================================================

TRUNCATE TABLE scoring_prompts;

-- ============================================================
-- 4. session_idカラムの型をUUIDに変更
-- ============================================================

ALTER TABLE scoring_prompts
ALTER COLUMN session_id TYPE UUID USING NULL;

-- ============================================================
-- 5. 外部キー制約を再作成
-- ============================================================

ALTER TABLE scoring_prompts
ADD CONSTRAINT scoring_prompts_session_id_fkey
FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

-- ============================================================
-- 6. idカラムもUUIDに変更（一貫性のため）
-- ============================================================

-- idカラムもbigintからUUIDに変更
ALTER TABLE scoring_prompts
ALTER COLUMN id TYPE UUID USING gen_random_uuid();

-- デフォルト値を設定
ALTER TABLE scoring_prompts
ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ============================================================
-- 7. 完了メッセージ
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 025_fix_scoring_prompts_session_id_type.sql completed successfully';
  RAISE NOTICE '- Changed scoring_prompts.session_id from bigint to UUID';
  RAISE NOTICE '- Changed scoring_prompts.id from bigint to UUID';
  RAISE NOTICE '- Recreated foreign key constraint';
  RAISE NOTICE '- All existing records were deleted (bigint to UUID conversion not possible)';
END $$;
