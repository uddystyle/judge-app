-- resultsテーブルにDELETEポリシーを追加
-- 主任検定員のみが得点を削除できるようにする

-- authenticated ユーザー用（主任検定員のみ）
CREATE POLICY "chief_judge_can_delete_results"
ON results
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = results.session_id
    AND sessions.chief_judge_id = auth.uid()
  )
);

-- anon ユーザー用（削除不可）
-- ゲストユーザーは削除できないようにする
-- ポリシーを作成しないことで、anonユーザーはDELETEできない
