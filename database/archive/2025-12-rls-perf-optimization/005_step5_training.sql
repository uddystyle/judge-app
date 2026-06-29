-- ============================================================
-- Step 5: TRAINING_EVENTS + TRAINING_SESSIONS テーブルの最適化
-- ============================================================
-- リスク: 中（トレーニングモードで使用）
-- 期待効果: トレーニングモードが高速化
-- テスト項目: トレーニングモードの設定、採点
-- ============================================================

-- TRAINING_EVENTS の最適化
DROP POLICY IF EXISTS "Session participants can view training events" ON training_events;
CREATE POLICY "Session participants can view training events"
ON training_events FOR SELECT
TO authenticated
USING (is_session_participant(session_id));

DROP POLICY IF EXISTS "Session creators can insert training events" ON training_events;
CREATE POLICY "Session creators can insert training events"
ON training_events FOR INSERT
TO authenticated
WITH CHECK (is_session_creator(session_id));

DROP POLICY IF EXISTS "Session creators can update training events" ON training_events;
CREATE POLICY "Session creators can update training events"
ON training_events FOR UPDATE
TO authenticated
USING (is_session_creator(session_id));

DROP POLICY IF EXISTS "Session creators can delete training events" ON training_events;
CREATE POLICY "Session creators can delete training events"
ON training_events FOR DELETE
TO authenticated
USING (is_session_creator(session_id));

-- TRAINING_SESSIONS の最適化
DROP POLICY IF EXISTS "Session participants can view training sessions" ON training_sessions;
CREATE POLICY "Session participants can view training sessions"
ON training_sessions FOR SELECT
TO authenticated
USING (is_session_participant(session_id));

DROP POLICY IF EXISTS "Session creators can manage training sessions" ON training_sessions;
CREATE POLICY "Session creators can manage training sessions"
ON training_sessions FOR ALL
TO authenticated
USING (is_session_creator(session_id));

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '✓ Step 5 完了: TRAINING_EVENTS + TRAINING_SESSIONS テーブルが最適化されました';
  RAISE NOTICE '';
  RAISE NOTICE '【テスト項目】';
  RAISE NOTICE '1. トレーニングモードでセッションを作成できるか';
  RAISE NOTICE '2. トレーニング種目を追加できるか';
  RAISE NOTICE '3. トレーニングセッションが表示されるか';
  RAISE NOTICE '';
  RAISE NOTICE '問題がなければ 005_step6_training_scores.sql を実行してください';
  RAISE NOTICE '問題があればロールバックしてください';
END $$;
