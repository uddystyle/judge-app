-- ============================================================
-- Phase 6: 組織ベースのRLSポリシーの見直し
-- ============================================================

-- ============================================================
-- sessions テーブルのRLSポリシー更新
-- ============================================================

-- 古いポリシーを削除
DROP POLICY IF EXISTS "Users can view sessions they participate in" ON sessions;
DROP POLICY IF EXISTS "Organization members can view organization sessions" ON sessions;
DROP POLICY IF EXISTS "Users can create sessions" ON sessions;
DROP POLICY IF EXISTS "Chief judge can update sessions" ON sessions;
DROP POLICY IF EXISTS "Chief judge can delete sessions" ON sessions;

-- 新しいポリシー: 組織メンバーは組織のセッションを閲覧可能
CREATE POLICY "Organization members can view organization sessions"
  ON sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = sessions.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- セッション作成: 組織メンバーが作成可能
CREATE POLICY "Organization members can create sessions"
  ON sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = sessions.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- セッション更新: 主任検定員または組織管理者が更新可能
CREATE POLICY "Chief judge or admin can update sessions"
  ON sessions FOR UPDATE
  TO authenticated
  USING (
    chief_judge_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = sessions.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- セッション削除: 主任検定員または組織管理者が削除可能
CREATE POLICY "Chief judge or admin can delete sessions"
  ON sessions FOR DELETE
  TO authenticated
  USING (
    chief_judge_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = sessions.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- ============================================================
-- session_participants テーブルのRLSポリシー
-- ============================================================

-- 古いポリシーを削除
DROP POLICY IF EXISTS "Users can view their own participation" ON session_participants;
DROP POLICY IF EXISTS "Users can view participants in their sessions" ON session_participants;
DROP POLICY IF EXISTS "Users can join sessions" ON session_participants;

-- 新しいポリシー: 組織メンバーとゲストが参加者として閲覧可能
CREATE POLICY "Organization members and guests can view participants"
  ON session_participants FOR SELECT
  TO authenticated
  USING (
    -- 自分自身の参加記録は見られる
    user_id = auth.uid()
    OR EXISTS (
      -- または、そのセッションの組織メンバーなら見られる
      SELECT 1 FROM sessions
      JOIN organization_members ON organization_members.organization_id = sessions.organization_id
      WHERE sessions.id = session_participants.session_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- 参加者の追加: 認証済みユーザーは自分自身を参加者として追加可能
CREATE POLICY "Users can join sessions"
  ON session_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
  );

-- 参加者の削除: 自分自身または組織管理者が削除可能
CREATE POLICY "Users or admins can remove participants"
  ON session_participants FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM sessions
      JOIN organization_members ON organization_members.organization_id = sessions.organization_id
      WHERE sessions.id = session_participants.session_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- ============================================================
-- organizations テーブルのRLSポリシー
-- ============================================================

-- 組織の閲覧: メンバーのみ
DROP POLICY IF EXISTS "Members can view their organization" ON organizations;
CREATE POLICY "Members can view their organization"
  ON organizations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
    )
  );

-- 組織の更新: 管理者のみ
DROP POLICY IF EXISTS "Admins can update their organization" ON organizations;
CREATE POLICY "Admins can update their organization"
  ON organizations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- ============================================================
-- organization_members テーブルのRLSポリシー
-- ============================================================

-- メンバー情報の閲覧: 同じ組織のメンバーが閲覧可能
DROP POLICY IF EXISTS "select_all_memberships" ON organization_members;
CREATE POLICY "Organization members can view members"
  ON organization_members FOR SELECT
  TO authenticated
  USING (
    -- 自分自身のメンバーシップは見られる
    user_id = auth.uid()
    OR EXISTS (
      -- または、同じ組織のメンバーなら見られる
      SELECT 1 FROM organization_members AS om2
      WHERE om2.organization_id = organization_members.organization_id
        AND om2.user_id = auth.uid()
    )
  );

-- メンバーの削除: 管理者または本人が削除可能
DROP POLICY IF EXISTS "Admins or self can delete members" ON organization_members;
CREATE POLICY "Admins or self can delete members"
  ON organization_members FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM organization_members AS om2
      WHERE om2.organization_id = organization_members.organization_id
        AND om2.user_id = auth.uid()
        AND om2.role = 'admin'
    )
  );
