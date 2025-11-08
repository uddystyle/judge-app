-- ===================================================================
-- 既存ユーザーの組織データをクリーンアップ
-- ===================================================================
-- このSQLは、既存のユーザーが組織を新規作成できるように
-- 既存の組織メンバーシップとセッションデータを削除します
--
-- 実行前に以下を確認してください：
-- 1. どのユーザーのデータを削除するか
-- 2. 削除するデータのバックアップを取る（必要に応じて）
-- ===================================================================

-- すべてのセッションを削除（組織に関連付けられているセッションも含む）
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sessions') THEN
    TRUNCATE TABLE sessions CASCADE;
    RAISE NOTICE 'sessions table truncated';
  END IF;
END $$;

-- すべての組織メンバーシップを削除
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'organization_members') THEN
    TRUNCATE TABLE organization_members CASCADE;
    RAISE NOTICE 'organization_members table truncated';
  END IF;
END $$;

-- すべての組織を削除
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'organizations') THEN
    TRUNCATE TABLE organizations CASCADE;
    RAISE NOTICE 'organizations table truncated';
  END IF;
END $$;

-- サブスクリプション関連データも削除（テーブルが存在する場合のみ）
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'subscription_usage') THEN
    TRUNCATE TABLE subscription_usage CASCADE;
    RAISE NOTICE 'subscription_usage table truncated';
  ELSE
    RAISE NOTICE 'subscription_usage table does not exist, skipping';
  END IF;
END $$;

-- プロフィールは保持（削除しない）
-- auth.usersテーブルのユーザーアカウントも保持（削除しない）

-- 実行後、以下のクエリでクリーンアップを確認：
SELECT
  'organizations' as table_name,
  COUNT(*) as remaining_records
FROM organizations
UNION ALL
SELECT
  'organization_members',
  COUNT(*)
FROM organization_members
UNION ALL
SELECT
  'sessions',
  COUNT(*)
FROM sessions;
