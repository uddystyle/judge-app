-- 現在ログインしているユーザーの既存データを確認するクエリ

-- 1. 自分のユーザーIDを確認（auth.usersテーブルからメールアドレスで検索）
-- ※ メールアドレスを自分のものに変更してください
SELECT id, email, created_at
FROM auth.users
WHERE email = 'your-email@example.com';

-- 2. 組織メンバーシップを確認
-- ※ 上記で取得したユーザーIDを使用してください
SELECT om.*, o.name as organization_name, o.plan_type
FROM organization_members om
LEFT JOIN organizations o ON om.organization_id = o.id
WHERE om.user_id = 'YOUR_USER_ID_HERE';

-- 3. 既存の組織を確認
SELECT * FROM organizations;

-- 4. 既存のセッションを確認
SELECT id, name, organization_id, created_by, created_at
FROM sessions
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================
-- クリーンアップ用クエリ（必要に応じて実行）
-- ============================================================

-- 特定ユーザーの組織メンバーシップを削除
-- DELETE FROM organization_members WHERE user_id = 'YOUR_USER_ID_HERE';

-- 特定の組織を削除（関連データもカスケード削除される）
-- DELETE FROM organizations WHERE id = 'ORGANIZATION_ID_HERE';

-- すべての組織データをクリーンアップ（注意：全削除）
-- TRUNCATE TABLE organization_members CASCADE;
-- TRUNCATE TABLE organizations CASCADE;
-- TRUNCATE TABLE sessions CASCADE;
