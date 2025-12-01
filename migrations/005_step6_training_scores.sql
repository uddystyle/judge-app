-- ============================================================
-- Step 6: TRAINING_SCORES テーブルの最適化
-- ============================================================
-- リスク: 低（UPDATE ポリシーのみ最適化）
-- 期待効果: トレーニングスコア更新が高速化
-- テスト項目: トレーニング採点
-- ============================================================

-- TRAINING_SCORES の UPDATE ポリシーのみ最適化
-- (他のポリシーは複雑なので変更しない)
DROP POLICY IF EXISTS "Authenticated users can update their own training scores" ON training_scores;
CREATE POLICY "Authenticated users can update their own training scores"
ON training_scores FOR UPDATE
TO authenticated
USING (judge_id = get_current_user_id())
WITH CHECK (judge_id = get_current_user_id());

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '✓ Step 6 完了: TRAINING_SCORES テーブルが最適化されました';
  RAISE NOTICE '';
  RAISE NOTICE '【テスト項目】';
  RAISE NOTICE '1. トレーニングモードで採点できるか';
  RAISE NOTICE '2. 採点結果を編集できるか';
  RAISE NOTICE '';
  RAISE NOTICE '🎉 すべての最適化が完了しました！';
  RAISE NOTICE '';
  RAISE NOTICE '【最終確認】';
  RAISE NOTICE '1. すべての機能が正常に動作するか';
  RAISE NOTICE '2. エラーログに問題がないか';
  RAISE NOTICE '3. パフォーマンスが向上したか';
END $$;
