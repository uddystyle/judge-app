-- ============================================================
-- Step 2: PROFILES テーブルの最適化
-- ============================================================
-- リスク: 低（シンプルなテーブル、自己参照なし）
-- 期待効果: プロフィール表示が高速化
-- テスト項目: ログイン、プロフィール表示
-- ============================================================

-- 最適化前の状態を確認
DO $$
BEGIN
  RAISE NOTICE '=== 最適化前のポリシー ===';
END $$;

SELECT policyname, qual
FROM pg_policies
WHERE tablename = 'profiles';

-- ポリシーを最適化
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (id = get_current_user_id());

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
TO authenticated
USING (id = get_current_user_id());

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (id = get_current_user_id());

-- 最適化後の状態を確認
DO $$
BEGIN
  RAISE NOTICE '=== 最適化後のポリシー ===';
END $$;

SELECT policyname, qual
FROM pg_policies
WHERE tablename = 'profiles';

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '✓ Step 2 完了: PROFILES テーブルが最適化されました';
  RAISE NOTICE '';
  RAISE NOTICE '【テスト項目】';
  RAISE NOTICE '1. アプリにログインできるか';
  RAISE NOTICE '2. プロフィールページが表示されるか';
  RAISE NOTICE '3. プロフィールを編集できるか';
  RAISE NOTICE '';
  RAISE NOTICE '問題がなければ 005_step3_sessions.sql を実行してください';
  RAISE NOTICE '問題があれば 005_rollback_step2.sql を実行してください';
END $$;
