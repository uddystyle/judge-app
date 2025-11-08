-- session_participants テーブルのRLSポリシーを修正
-- 無限再帰を避けるためにシンプルなポリシーに変更

-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Organization members and guests can view participants" ON session_participants;
DROP POLICY IF EXISTS "Users can join sessions" ON session_participants;
DROP POLICY IF EXISTS "Users or admins can remove participants" ON session_participants;

-- 新しいシンプルなポリシー

-- 閲覧: 認証済みユーザーは全ての参加者情報を閲覧可能
-- （組織ベースのアクセス制御はsessionsテーブルで行う）
CREATE POLICY "Authenticated users can view participants"
  ON session_participants FOR SELECT
  TO authenticated
  USING (true);

-- 挿入: ユーザーは自分自身を参加者として追加可能
CREATE POLICY "Users can join sessions"
  ON session_participants FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 削除: ユーザーは自分自身の参加記録を削除可能
CREATE POLICY "Users can remove own participation"
  ON session_participants FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
