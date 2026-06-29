-- ============================================================
-- ロールバック: すべての最適化を元に戻す
-- ============================================================
-- 問題が発生した場合に実行してください
-- ============================================================

-- PROFILES
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
ON profiles FOR SELECT
TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- SESSIONS
DROP POLICY IF EXISTS "Users can view own sessions" ON sessions;
CREATE POLICY "Users can view own sessions"
ON sessions FOR SELECT
TO authenticated
USING (created_by = auth.uid());

DROP POLICY IF EXISTS "Users can create sessions" ON sessions;
CREATE POLICY "Users can create sessions"
ON sessions FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Users can update own sessions" ON sessions;
CREATE POLICY "Users can update own sessions"
ON sessions FOR UPDATE
TO authenticated
USING (created_by = auth.uid());

DROP POLICY IF EXISTS "Users can delete own sessions" ON sessions;
CREATE POLICY "Users can delete own sessions"
ON sessions FOR DELETE
TO authenticated
USING (created_by = auth.uid());

DROP POLICY IF EXISTS "Chief judges can view sessions" ON sessions;
CREATE POLICY "Chief judges can view sessions"
ON sessions FOR SELECT
TO authenticated
USING (chief_judge_id = auth.uid());

DROP POLICY IF EXISTS "Organization members can view organization sessions" ON sessions;
CREATE POLICY "Organization members can view organization sessions"
ON sessions FOR SELECT
TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id IN (SELECT get_user_organization_ids())
);

-- CUSTOM_EVENTS (元のポリシー名に戻す)
DROP POLICY IF EXISTS "Session participants can view custom events" ON custom_events;
DROP POLICY IF EXISTS "Session creators can insert custom events" ON custom_events;
DROP POLICY IF EXISTS "Session creators can update custom events" ON custom_events;
DROP POLICY IF EXISTS "Session creators can delete custom events" ON custom_events;

-- Note: 元のポリシー名が不明な場合は、database/migrations/001_add_tournament_mode.sql を参照

-- TRAINING_SCORES
DROP POLICY IF EXISTS "Authenticated users can update their own training scores" ON training_scores;
CREATE POLICY "Authenticated users can update their own training scores"
ON training_scores FOR UPDATE
TO authenticated
USING (judge_id = auth.uid())
WITH CHECK (judge_id = auth.uid());

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '✓ ロールバック完了';
  RAISE NOTICE '元の auth.uid() パターンに戻りました';
  RAISE NOTICE '';
  RAISE NOTICE 'Helper関数は残っていますが、使用されていません';
  RAISE NOTICE '削除したい場合は以下を実行:';
  RAISE NOTICE 'DROP FUNCTION IF EXISTS get_current_user_id();';
  RAISE NOTICE 'DROP FUNCTION IF EXISTS is_session_creator(BIGINT);';
  RAISE NOTICE 'DROP FUNCTION IF EXISTS is_session_participant(BIGINT);';
END $$;
