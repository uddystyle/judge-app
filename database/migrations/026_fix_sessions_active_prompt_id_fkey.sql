-- Migration: Fix sessions.active_prompt_id Foreign Key Constraint
-- Description: sessions.active_prompt_idの外部キー制約をprofilesからscoring_promptsに修正
-- Date: 2025-01-12

-- ============================================================
-- 1. 既存の外部キー制約を確認
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sessions_active_prompt_id_fkey'
    AND table_name = 'sessions'
  ) THEN
    RAISE NOTICE 'Found existing foreign key constraint: sessions_active_prompt_id_fkey';
  END IF;
END $$;

-- ============================================================
-- 2. 間違った外部キー制約を削除
-- ============================================================

DO $$
BEGIN
  ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_active_prompt_id_fkey;

  RAISE NOTICE 'Dropped incorrect foreign key constraint (profiles)';
END $$;

-- ============================================================
-- 3. active_prompt_idの型を確認して必要に応じて変更
-- ============================================================

-- active_prompt_idの型をUUIDに変更（scoring_prompts.idに合わせる）
-- NULLを許可（採点指示がない状態を表現）
DO $$
BEGIN
  -- 型がUUIDでない場合のみ変更
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sessions'
    AND column_name = 'active_prompt_id'
    AND data_type != 'uuid'
  ) THEN
    -- 既存のデータをクリア（型変換できないため）
    UPDATE sessions SET active_prompt_id = NULL;

    -- 型を変更
    ALTER TABLE sessions
    ALTER COLUMN active_prompt_id TYPE UUID USING NULL;

    RAISE NOTICE 'Changed active_prompt_id type to UUID';
  ELSE
    RAISE NOTICE 'active_prompt_id is already UUID type';
  END IF;
END $$;

-- ============================================================
-- 4. 正しい外部キー制約を作成
-- ============================================================

DO $$
BEGIN
  ALTER TABLE sessions
  ADD CONSTRAINT sessions_active_prompt_id_fkey
  FOREIGN KEY (active_prompt_id) REFERENCES scoring_prompts(id) ON DELETE SET NULL;

  RAISE NOTICE 'Created correct foreign key constraint (scoring_prompts)';
END $$;

-- ============================================================
-- 5. 完了メッセージ
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 026_fix_sessions_active_prompt_id_fkey.sql completed successfully';
  RAISE NOTICE '- Dropped incorrect foreign key constraint (profiles)';
  RAISE NOTICE '- Changed active_prompt_id type to UUID if needed';
  RAISE NOTICE '- Created correct foreign key constraint (scoring_prompts)';
END $$;
