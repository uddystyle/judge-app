-- ============================================================
-- Migration 055: 組織作成のトランザクション処理関数を追加
-- ============================================================
-- 実行日: 2026-01-22
-- 説明: 既存のサブスクリプションを使用して組織を作成する処理をトランザクション化
-- ============================================================

-- ============================================================
-- 問題の説明
-- ============================================================
-- 現状: /api/organization/create では以下の処理を別々のクエリで実行
--   1. 組織作成
--   2. メンバー追加
--   3. サブスクリプション更新
--
-- 問題: 途中で失敗すると不整合な状態になる
--   - 組織は作成されたがメンバーがいない
--   - サブスクリプションが組織に紐づかない
--   - 孤児レコードが残る
--
-- 解決策: Postgres関数でトランザクション処理を実装
-- ============================================================

-- ============================================================
-- 1. 組織作成のトランザクション関数
-- ============================================================

CREATE OR REPLACE FUNCTION create_organization_with_subscription(
  p_user_id UUID,
  p_organization_name TEXT,
  p_plan_type TEXT,
  p_max_members INTEGER,
  p_subscription_id BIGINT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_organization_id UUID;
  v_stripe_customer_id TEXT;
  v_stripe_subscription_id TEXT;
  v_result JSON;
BEGIN
  -- 入力バリデーション
  IF p_user_id IS NULL OR p_organization_name IS NULL OR p_plan_type IS NULL THEN
    RAISE EXCEPTION 'Required parameters are missing';
  END IF;

  -- サブスクリプション情報を取得して検証
  SELECT
    stripe_customer_id,
    stripe_subscription_id,
    organization_id
  INTO
    v_stripe_customer_id,
    v_stripe_subscription_id,
    v_organization_id
  FROM subscriptions
  WHERE id = p_subscription_id
    AND user_id = p_user_id
    AND status = 'active'
    AND plan_type = p_plan_type;

  -- サブスクリプションが見つからない場合
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Valid subscription not found';
  END IF;

  -- 既に組織に紐づいている場合
  IF v_organization_id IS NOT NULL THEN
    RAISE EXCEPTION 'Subscription already linked to an organization';
  END IF;

  -- トランザクション開始（関数内では自動的にトランザクション）

  -- 1. 組織を作成
  INSERT INTO organizations (
    name,
    plan_type,
    max_members,
    stripe_customer_id,
    stripe_subscription_id
  ) VALUES (
    p_organization_name,
    p_plan_type,
    p_max_members,
    v_stripe_customer_id,
    v_stripe_subscription_id
  )
  RETURNING id INTO v_organization_id;

  -- 2. 作成者を管理者として追加
  INSERT INTO organization_members (
    organization_id,
    user_id,
    role
  ) VALUES (
    v_organization_id,
    p_user_id,
    'admin'
  );

  -- 3. サブスクリプションに組織IDを紐付け
  UPDATE subscriptions
  SET organization_id = v_organization_id
  WHERE id = p_subscription_id;

  -- 成功結果を返す
  v_result := json_build_object(
    'success', true,
    'organization_id', v_organization_id,
    'organization_name', p_organization_name,
    'plan_type', p_plan_type
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    -- エラーが発生した場合、トランザクション全体がロールバックされる
    RAISE EXCEPTION 'Organization creation failed: %', SQLERRM;
END;
$$;

-- ============================================================
-- 2. 関数の権限設定
-- ============================================================

-- 認証済みユーザーが実行可能にする
GRANT EXECUTE ON FUNCTION create_organization_with_subscription(UUID, TEXT, TEXT, INTEGER, BIGINT) TO authenticated;

-- ============================================================
-- 3. コメント追加
-- ============================================================

COMMENT ON FUNCTION create_organization_with_subscription IS
'既存のサブスクリプションを使用して組織を作成する。
すべての処理（組織作成、メンバー追加、サブスクリプション更新）が
トランザクション内で実行されるため、途中で失敗した場合は
すべてロールバックされる。';

-- ============================================================
-- 完了
-- ============================================================
-- マイグレーション完了！
-- 次のステップ: /api/organization/create のコードを修正してこの関数を使用
-- ============================================================
