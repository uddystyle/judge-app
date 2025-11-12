-- Migration: Add missing RLS policies for participants table
-- Description: 030のマイグレーションでparticipantsテーブルのポリシーが作成されていなかったため追加
-- Date: 2025-11-12

-- participants テーブルのポリシー

-- 認証済みユーザーは全てのparticipantsを閲覧可能
CREATE POLICY "Authenticated users can view participants"
  ON participants FOR SELECT
  TO authenticated
  USING (true);

-- 匿名ユーザー（ゲスト）も全てのparticipantsを閲覧可能
CREATE POLICY "Anonymous users can view participants"
  ON participants FOR SELECT
  TO anon
  USING (true);

-- 認証済みユーザーはparticipantsを作成可能（主任検定員がゼッケン番号入力時に必要）
CREATE POLICY "Authenticated users can insert participants"
  ON participants FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 認証済みユーザーはparticipantsを更新可能
CREATE POLICY "Authenticated users can update participants"
  ON participants FOR UPDATE
  TO authenticated
  USING (true);

-- 認証済みユーザーはparticipantsを削除可能
CREATE POLICY "Authenticated users can delete participants"
  ON participants FOR DELETE
  TO authenticated
  USING (true);

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 033_add_participants_rls_policies.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '- Added SELECT policies for authenticated and anonymous users';
  RAISE NOTICE '- Added INSERT, UPDATE, DELETE policies for authenticated users';
  RAISE NOTICE '- Chief judges can now create participant records when entering bib numbers';
  RAISE NOTICE '=================================================================';
END $$;
