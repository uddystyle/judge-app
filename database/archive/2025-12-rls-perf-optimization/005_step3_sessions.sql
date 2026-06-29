-- ============================================================
-- Step 3: SESSIONS テーブルの最適化
-- ============================================================
-- リスク: 中（重要なテーブル）
-- 期待効果: セッション一覧・詳細が高速化
-- テスト項目: セッション一覧、セッション作成、セッション詳細
-- ============================================================

-- 最適化前の状態を確認
DO $$
BEGIN
  RAISE NOTICE '=== 最適化前のポリシー ===';
END $$;

SELECT policyname, qual
FROM pg_policies
WHERE tablename = 'sessions';

-- ポリシーを最適化
DROP POLICY IF EXISTS "Users can view own sessions" ON sessions;
CREATE POLICY "Users can view own sessions"
ON sessions FOR SELECT
TO authenticated
USING (created_by = get_current_user_id());

DROP POLICY IF EXISTS "Users can create sessions" ON sessions;
CREATE POLICY "Users can create sessions"
ON sessions FOR INSERT
TO authenticated
WITH CHECK (created_by = get_current_user_id());

DROP POLICY IF EXISTS "Users can update own sessions" ON sessions;
CREATE POLICY "Users can update own sessions"
ON sessions FOR UPDATE
TO authenticated
USING (created_by = get_current_user_id());

DROP POLICY IF EXISTS "Users can delete own sessions" ON sessions;
CREATE POLICY "Users can delete own sessions"
ON sessions FOR DELETE
TO authenticated
USING (created_by = get_current_user_id());

DROP POLICY IF EXISTS "Chief judges can view sessions" ON sessions;
CREATE POLICY "Chief judges can view sessions"
ON sessions FOR SELECT
TO authenticated
USING (chief_judge_id = get_current_user_id());

DROP POLICY IF EXISTS "Organization members can view organization sessions" ON sessions;
CREATE POLICY "Organization members can view organization sessions"
ON sessions FOR SELECT
TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id IN (SELECT get_user_organization_ids())
);

-- 最適化後の状態を確認
DO $$
BEGIN
  RAISE NOTICE '=== 最適化後のポリシー ===';
END $$;

SELECT policyname, qual
FROM pg_policies
WHERE tablename = 'sessions';

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '✓ Step 3 完了: SESSIONS テーブルが最適化されました';
  RAISE NOTICE '';
  RAISE NOTICE '【テスト項目】';
  RAISE NOTICE '1. ダッシュボードでセッション一覧が表示されるか';
  RAISE NOTICE '2. 新しいセッションを作成できるか';
  RAISE NOTICE '3. セッション詳細ページが表示されるか';
  RAISE NOTICE '4. 組織のセッションが表示されるか（組織メンバーの場合）';
  RAISE NOTICE '';
  RAISE NOTICE '問題がなければ 005_step4_custom_events.sql を実行してください';
  RAISE NOTICE '問題があれば 005_rollback_step3.sql を実行してください';
END $$;
