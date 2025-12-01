-- ============================================================
-- Step 4: CUSTOM_EVENTS + PARTICIPANTS テーブルの最適化
-- ============================================================
-- リスク: 中（大会モードで使用）
-- 期待効果: 種目設定、参加者管理が高速化
-- テスト項目: 大会モードの種目設定、参加者登録
-- ============================================================

-- CUSTOM_EVENTS の最適化
DROP POLICY IF EXISTS "Session participants can view custom events" ON custom_events;
CREATE POLICY "Session participants can view custom events"
ON custom_events FOR SELECT
TO authenticated
USING (is_session_participant(session_id));

DROP POLICY IF EXISTS "Session creators can insert custom events" ON custom_events;
CREATE POLICY "Session creators can insert custom events"
ON custom_events FOR INSERT
TO authenticated
WITH CHECK (is_session_creator(session_id));

DROP POLICY IF EXISTS "Session creators can update custom events" ON custom_events;
CREATE POLICY "Session creators can update custom events"
ON custom_events FOR UPDATE
TO authenticated
USING (is_session_creator(session_id));

DROP POLICY IF EXISTS "Session creators can delete custom events" ON custom_events;
CREATE POLICY "Session creators can delete custom events"
ON custom_events FOR DELETE
TO authenticated
USING (is_session_creator(session_id));

-- PARTICIPANTS の最適化
DROP POLICY IF EXISTS "Session participants can view participants" ON participants;
CREATE POLICY "Session participants can view participants"
ON participants FOR SELECT
TO authenticated
USING (is_session_participant(session_id));

DROP POLICY IF EXISTS "Session creators can insert participants" ON participants;
CREATE POLICY "Session creators can insert participants"
ON participants FOR INSERT
TO authenticated
WITH CHECK (is_session_creator(session_id));

DROP POLICY IF EXISTS "Session creators can update participants" ON participants;
CREATE POLICY "Session creators can update participants"
ON participants FOR UPDATE
TO authenticated
USING (is_session_creator(session_id));

DROP POLICY IF EXISTS "Session creators can delete participants" ON participants;
CREATE POLICY "Session creators can delete participants"
ON participants FOR DELETE
TO authenticated
USING (is_session_creator(session_id));

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '✓ Step 4 完了: CUSTOM_EVENTS + PARTICIPANTS テーブルが最適化されました';
  RAISE NOTICE '';
  RAISE NOTICE '【テスト項目】';
  RAISE NOTICE '1. 大会モードでセッションを作成できるか';
  RAISE NOTICE '2. カスタム種目を追加できるか';
  RAISE NOTICE '3. 参加者を登録できるか';
  RAISE NOTICE '4. スコアボードが表示されるか';
  RAISE NOTICE '';
  RAISE NOTICE '問題がなければ 005_step5_training.sql を実行してください';
  RAISE NOTICE '問題があればロールバックしてください';
END $$;
