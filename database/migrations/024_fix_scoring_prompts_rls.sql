-- Migration: Fix scoring_prompts RLS Policies
-- Description: scoring_promptsテーブルのRLSポリシーを修正して、認証済みユーザーとゲストユーザーがアクセスできるようにする
-- Date: 2025-01-12

-- ============================================================
-- 1. 既存のポリシーを確認して削除
-- ============================================================

-- 既存のポリシーをすべて削除
DO $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE tablename = 'scoring_prompts'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON scoring_prompts', policy_record.policyname);
    RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
  END LOOP;
END $$;

-- ============================================================
-- 2. 新しいポリシーを作成
-- ============================================================

-- SELECT: 認証済みユーザーと匿名ユーザー（ゲスト）がすべてのレコードを閲覧可能
CREATE POLICY "authenticated_users_select_scoring_prompts"
ON scoring_prompts FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "anon_users_select_scoring_prompts"
ON scoring_prompts FOR SELECT
TO anon
USING (true);

-- INSERT: 認証済みユーザーがレコードを作成可能
CREATE POLICY "authenticated_users_insert_scoring_prompts"
ON scoring_prompts FOR INSERT
TO authenticated
WITH CHECK (true);

-- 匿名ユーザー（ゲスト）も必要に応じてレコードを作成可能にする
-- （主任検定員がゲストの場合に備えて）
CREATE POLICY "anon_users_insert_scoring_prompts"
ON scoring_prompts FOR INSERT
TO anon
WITH CHECK (true);

-- UPDATE: 認証済みユーザーがレコードを更新可能
CREATE POLICY "authenticated_users_update_scoring_prompts"
ON scoring_prompts FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "anon_users_update_scoring_prompts"
ON scoring_prompts FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- DELETE: 認証済みユーザーがレコードを削除可能
CREATE POLICY "authenticated_users_delete_scoring_prompts"
ON scoring_prompts FOR DELETE
TO authenticated
USING (true);

-- ============================================================
-- 3. RLSが有効か確認
-- ============================================================

-- RLSを有効化（すでに有効な場合はスキップされる）
ALTER TABLE scoring_prompts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. 完了メッセージ
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 024_fix_scoring_prompts_rls.sql completed successfully';
  RAISE NOTICE '- Dropped existing RLS policies for scoring_prompts';
  RAISE NOTICE '- Created new permissive policies for authenticated and anon users';
  RAISE NOTICE '- Enabled RLS on scoring_prompts table';
END $$;
