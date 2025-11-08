-- ============================================================
-- TENTO Organization Features Migration
-- ============================================================
-- このファイルをSupabase SQL Editorで実行してください
-- ============================================================
-- 実行日: 2025-11-05
-- 説明: 組織機能・検定員招待機能の追加
-- ============================================================

-- ============================================================
-- 1. organizations テーブル
-- ============================================================
-- 組織（スキークラブ、スキー学校など）の情報を管理

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,

  -- プラン情報
  plan_type TEXT NOT NULL CHECK (plan_type IN ('basic', 'standard', 'enterprise')),
  max_members INTEGER NOT NULL, -- 検定員の最大登録数

  -- Stripe関連
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,

  -- タイムスタンプ
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer_id ON organizations(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_subscription_id ON organizations(stripe_subscription_id);

-- ============================================================
-- 2. organization_members テーブル
-- ============================================================
-- 組織とユーザーの紐付け（多対多）

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- 役割
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')) DEFAULT 'member',

  -- タイムスタンプ
  joined_at TIMESTAMPTZ DEFAULT NOW(),

  -- 1つの組織に同じユーザーは1回のみ参加可能
  UNIQUE(organization_id, user_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_organization_members_organization_id ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_user_id ON organization_members(user_id);

-- ============================================================
-- 3. invitations テーブル
-- ============================================================
-- 組織への招待を管理

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 招待トークン（URLに含まれる）
  token TEXT UNIQUE NOT NULL,

  -- 組織と作成者
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- オプション：特定のメールアドレス宛の招待
  email TEXT,

  -- 招待される役割
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')) DEFAULT 'member',

  -- 有効期限
  expires_at TIMESTAMPTZ NOT NULL,

  -- 使用制限（NULLの場合は無制限）
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,

  -- タイムスタンプ
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_organization_id ON invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_invitations_expires_at ON invitations(expires_at);

-- ============================================================
-- 4. invitation_uses テーブル
-- ============================================================
-- 招待の使用履歴を記録

CREATE TABLE IF NOT EXISTS invitation_uses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invitation_id UUID REFERENCES invitations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS設定は後で一括設定します

-- インデックス
CREATE INDEX IF NOT EXISTS idx_invitation_uses_invitation_id ON invitation_uses(invitation_id);
CREATE INDEX IF NOT EXISTS idx_invitation_uses_user_id ON invitation_uses(user_id);

-- ============================================================
-- 5. 既存テーブルの拡張
-- ============================================================

-- subscriptions テーブルに organization_id を追加
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_subscriptions_organization_id ON subscriptions(organization_id);

-- sessions テーブルに organization_id を追加
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_sessions_organization_id ON sessions(organization_id);

-- sessionsテーブルに組織メンバー用のRLSポリシーを追加
-- 既存のポリシーは残したまま、新しいポリシーを追加
DROP POLICY IF EXISTS "Organization members can view organization sessions" ON sessions;
CREATE POLICY "Organization members can view organization sessions"
  ON sessions FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = sessions.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- ============================================================
-- 6. plan_limits テーブルに新プランを追加
-- ============================================================

INSERT INTO plan_limits (plan_type, max_sessions_per_month, max_athletes_per_session, max_judges_per_session, has_tournament_mode, has_training_mode, has_scoreboard, data_retention_months) VALUES
  ('basic', -1, -1, -1, true, true, true, -1),
  ('standard', -1, -1, -1, true, true, true, -1),
  ('enterprise', -1, -1, -1, true, true, true, -1)
ON CONFLICT (plan_type) DO NOTHING;

-- ============================================================
-- 7. updated_at自動更新トリガー
-- ============================================================

-- organizations テーブル用トリガー
DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 8. RLS Policy Setup (全テーブル作成後に設定)
-- ============================================================

-- ============================================================
-- 8-1. organizations テーブルのRLS設定
-- ============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- 組織のメンバーは自分の組織を閲覧可能
DROP POLICY IF EXISTS "Organization members can view their organization" ON organizations;
CREATE POLICY "Organization members can view their organization"
  ON organizations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
    )
  );

-- 組織の管理者は自分の組織を更新可能
DROP POLICY IF EXISTS "Organization admins can update their organization" ON organizations;
CREATE POLICY "Organization admins can update their organization"
  ON organizations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- ============================================================
-- 8-2. organization_members テーブルのRLS設定
-- ============================================================
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- ヘルパー関数：組織の管理者かどうかをチェック（無限再帰回避）
CREATE OR REPLACE FUNCTION is_organization_admin(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ユーザーは自分のメンバーシップを閲覧可能
DROP POLICY IF EXISTS "Users can view their own memberships" ON organization_members;
CREATE POLICY "Users can view their own memberships"
  ON organization_members FOR SELECT
  USING (user_id = auth.uid());

-- 管理者は同じ組織の全メンバーを閲覧可能
DROP POLICY IF EXISTS "Organization admins can view all members" ON organization_members;
CREATE POLICY "Organization admins can view all members"
  ON organization_members FOR SELECT
  USING (is_organization_admin(organization_id));

-- 組織の管理者はメンバーを削除可能
DROP POLICY IF EXISTS "Organization admins can delete members" ON organization_members;
CREATE POLICY "Organization admins can delete members"
  ON organization_members FOR DELETE
  USING (is_organization_admin(organization_id));

-- ============================================================
-- 8-3. invitations テーブルのRLS設定
-- ============================================================
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- 組織の管理者は招待を作成可能
DROP POLICY IF EXISTS "Organization admins can create invitations" ON invitations;
CREATE POLICY "Organization admins can create invitations"
  ON invitations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = invitations.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- 組織の管理者は招待を閲覧可能
DROP POLICY IF EXISTS "Organization admins can view invitations" ON invitations;
CREATE POLICY "Organization admins can view invitations"
  ON invitations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = invitations.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- 誰でも有効な招待トークンを閲覧可能（招待URL経由での参加のため）
DROP POLICY IF EXISTS "Anyone can view valid invitation by token" ON invitations;
CREATE POLICY "Anyone can view valid invitation by token"
  ON invitations FOR SELECT
  USING (
    expires_at > NOW()
    AND (max_uses IS NULL OR used_count < max_uses)
  );

-- 組織の管理者は招待を削除可能
DROP POLICY IF EXISTS "Organization admins can delete invitations" ON invitations;
CREATE POLICY "Organization admins can delete invitations"
  ON invitations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = invitations.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- ============================================================
-- 8-4. invitation_uses テーブルのRLS設定
-- ============================================================
ALTER TABLE invitation_uses ENABLE ROW LEVEL SECURITY;

-- 組織の管理者は使用履歴を閲覧可能
DROP POLICY IF EXISTS "Organization admins can view invitation uses" ON invitation_uses;
CREATE POLICY "Organization admins can view invitation uses"
  ON invitation_uses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM invitations
      JOIN organization_members ON organization_members.organization_id = invitations.organization_id
      WHERE invitations.id = invitation_uses.invitation_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role = 'admin'
    )
  );

-- ============================================================
-- 完了
-- ============================================================
-- マイグレーション完了しました！
-- 次のステップ: 組織作成機能の実装
-- ============================================================
