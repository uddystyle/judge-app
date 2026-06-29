-- フリープランの制限を確認
SELECT
    plan_type,
    max_sessions_per_month,
    max_organization_members,
    has_tournament_mode,
    has_training_mode
FROM plan_limits
WHERE plan_type = 'free';

-- 組織の今月のセッション数を確認
SELECT
    COUNT(*) as session_count_this_month,
    DATE_TRUNC('month', CURRENT_DATE) as current_month_start
FROM sessions
WHERE organization_id = '805ae237-9113-412a-9df3-05bb75da7586'
  AND deleted_at IS NULL
  AND created_at >= DATE_TRUNC('month', CURRENT_DATE);

-- 組織の全セッション数（削除済み除く）
SELECT
    COUNT(*) as total_active_sessions
FROM sessions
WHERE organization_id = '805ae237-9113-412a-9df3-05bb75da7586'
  AND deleted_at IS NULL;
