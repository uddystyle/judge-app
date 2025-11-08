-- ===================================================================
-- 現在のデータベース状態を確認するクエリ
-- ===================================================================

-- 1. すべての組織を表示
SELECT
    id,
    name,
    plan_type,
    max_members,
    created_at,
    stripe_customer_id,
    stripe_subscription_id
FROM organizations
ORDER BY created_at DESC;

-- 2. すべての組織メンバーシップを表示
SELECT
    om.id,
    om.user_id,
    p.full_name,
    au.email,
    om.organization_id,
    o.name as organization_name,
    om.role,
    om.joined_at
FROM organization_members om
LEFT JOIN profiles p ON om.user_id = p.id
LEFT JOIN auth.users au ON om.user_id = au.id
LEFT JOIN organizations o ON om.organization_id = o.id
ORDER BY om.joined_at DESC;

-- 3. すべてのセッションを表示
SELECT
    s.id,
    s.name,
    s.organization_id,
    o.name as organization_name,
    s.created_by,
    p.full_name as creator_name,
    s.created_at,
    s.mode,
    s.is_active
FROM sessions s
LEFT JOIN organizations o ON s.organization_id = o.id
LEFT JOIN profiles p ON s.created_by = p.id
ORDER BY s.created_at DESC
LIMIT 20;

-- 4. 現在ログインしているユーザーのメールアドレスを確認
-- （Supabase SQL Editorから実行している場合）
SELECT
    id,
    email,
    created_at,
    confirmed_at,
    last_sign_in_at
FROM auth.users
ORDER BY created_at DESC;

-- 5. データ数のサマリー
SELECT
    'organizations' as table_name,
    COUNT(*) as count
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
FROM sessions
UNION ALL
SELECT
    'profiles',
    COUNT(*)
FROM profiles
UNION ALL
SELECT
    'users (auth)',
    COUNT(*)
FROM auth.users;
