-- ===================================================================
-- 組織作成後のデータを確認
-- ===================================================================

-- 1. 最近作成された組織を確認
SELECT
    id,
    name,
    plan_type,
    max_members,
    created_at
FROM organizations
ORDER BY created_at DESC
LIMIT 5;

-- 2. 組織メンバーシップを確認
SELECT
    om.id,
    om.user_id,
    au.email,
    om.organization_id,
    o.name as organization_name,
    om.role,
    om.joined_at
FROM organization_members om
LEFT JOIN auth.users au ON om.user_id = au.id
LEFT JOIN organizations o ON om.organization_id = o.id
ORDER BY om.joined_at DESC
LIMIT 10;

-- 3. ユーザーごとの組織メンバーシップ数を確認
SELECT
    au.email,
    COUNT(om.id) as membership_count
FROM auth.users au
LEFT JOIN organization_members om ON au.id = om.user_id
GROUP BY au.id, au.email
ORDER BY au.created_at DESC
LIMIT 10;
