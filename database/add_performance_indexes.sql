-- パフォーマンス最適化のためのインデックス追加
-- Supabase SQL Editor で実行してください
--
-- 注: このSQLは既存のテーブルに対してのみインデックスを作成します
-- IF NOT EXISTS を使用しているため、既にインデックスが存在する場合はスキップされます

-- ============================================================
-- 高優先度: ダッシュボード・アカウントページで使用
-- ============================================================

-- 1. organization_members テーブル
-- ユーザーが所属する組織を高速に検索
CREATE INDEX IF NOT EXISTS idx_organization_members_user_id
ON organization_members(user_id);

-- 組織のメンバー一覧を高速に取得
CREATE INDEX IF NOT EXISTS idx_organization_members_organization_id
ON organization_members(organization_id);

-- 2. sessions テーブル
-- 組織のセッション一覧を高速に取得
CREATE INDEX IF NOT EXISTS idx_sessions_organization_id
ON sessions(organization_id);

-- 今月のセッションを高速に検索（複合インデックス）
CREATE INDEX IF NOT EXISTS idx_sessions_org_created
ON sessions(organization_id, created_at DESC);

-- モードでのフィルタリングを高速化
CREATE INDEX IF NOT EXISTS idx_sessions_mode
ON sessions(mode);

-- アクティブなセッションの検索を高速化
CREATE INDEX IF NOT EXISTS idx_sessions_is_active
ON sessions(is_active) WHERE is_active = true;

-- 3. session_participants テーブル
-- ユーザーがゲスト参加しているセッションを高速に検索
CREATE INDEX IF NOT EXISTS idx_session_participants_user_id
ON session_participants(user_id);

-- セッションの参加者一覧を高速に取得
CREATE INDEX IF NOT EXISTS idx_session_participants_session_id
ON session_participants(session_id);

-- ============================================================
-- 中優先度: 組織管理・統計用
-- ============================================================

-- 4. organizations テーブル
-- プランタイプでの検索を高速化（統計用）
CREATE INDEX IF NOT EXISTS idx_organizations_plan_type
ON organizations(plan_type);

-- 5. profiles テーブル
-- ユーザープロフィール検索を高速化（主キーなので通常は不要だが念のため）
-- 注: id は主キーのため、既にインデックスが存在します

-- インデックス追加完了
-- 実行後、以下のクエリでインデックスが作成されたことを確認できます:
-- SELECT schemaname, tablename, indexname
-- FROM pg_indexes
-- WHERE schemaname = 'public'
-- ORDER BY tablename, indexname;
