-- ============================================================
-- Migration 056: 組織作成関数を冪等にする
-- ============================================================
-- 実行日: 2026-01-22
-- 説明: create_organization_with_subscription関数を冪等にして、
--       重複リクエストや再試行時のエラーを防ぐ
-- ============================================================

-- ============================================================
-- 問題の説明
-- ============================================================
-- 現状: 同じサブスクリプションで複数回組織作成を試みると失敗
--   - ネットワークタイムアウト後の再試行
--   - 重複リクエスト
--   - stripe_subscription_idのUNIQUE制約違反エラー
--
-- 解決策: 既に組織が作成されている場合、その組織情報を返す
-- ============================================================

-- ============================================================
-- 1. 関数を置き換え（冪等性を追加）
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
  v_existing_org_id UUID;
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
    v_existing_org_id
  FROM subscriptions
  WHERE id = p_subscription_id
    AND user_id = p_user_id
    AND status = 'active'
    AND plan_type = p_plan_type;

  -- サブスクリプションが見つからない場合
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Valid subscription not found';
  END IF;

  -- 既に組織に紐づいている場合（冪等性チェック1）
  -- この組織が既に作成済みの場合は、その情報を返す
  IF v_existing_org_id IS NOT NULL THEN
    -- 既存の組織情報を取得
    SELECT id, name, plan_type
    INTO v_organization_id, p_organization_name, p_plan_type
    FROM organizations
    WHERE id = v_existing_org_id;

    -- ユーザーがこの組織のメンバーかどうか確認
    IF EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_id = v_existing_org_id
        AND user_id = p_user_id
    ) THEN
      -- 既に作成済みの組織情報を返す（冪等性）
      v_result := json_build_object(
        'success', true,
        'organization_id', v_organization_id,
        'organization_name', p_organization_name,
        'plan_type', p_plan_type,
        'already_exists', true
      );
      RETURN v_result;
    ELSE
      -- 組織は存在するが、リクエストユーザーがメンバーでない場合はエラー
      RAISE EXCEPTION 'Subscription already linked to a different organization';
    END IF;
  END IF;

  -- トランザクション開始（関数内では自動的にトランザクション）

  BEGIN
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

  EXCEPTION
    WHEN unique_violation THEN
      -- 冪等性チェック2: UNIQUE制約違反の場合、既存の組織を取得
      -- stripe_subscription_idのUNIQUE制約に違反した場合
      SELECT id, name, plan_type
      INTO v_organization_id, p_organization_name, p_plan_type
      FROM organizations
      WHERE stripe_subscription_id = v_stripe_subscription_id;

      -- 既存の組織が見つかった場合
      IF FOUND THEN
        -- ユーザーがメンバーかどうか確認
        IF EXISTS (
          SELECT 1 FROM organization_members
          WHERE organization_id = v_organization_id
            AND user_id = p_user_id
        ) THEN
          -- 既に作成済みの組織情報を返す
          v_result := json_build_object(
            'success', true,
            'organization_id', v_organization_id,
            'organization_name', p_organization_name,
            'plan_type', p_plan_type,
            'already_exists', true
          );
          RETURN v_result;
        ELSE
          RAISE EXCEPTION 'Subscription already linked to a different organization';
        END IF;
      ELSE
        -- 予期しないUNIQUE制約違反
        RAISE;
      END IF;
  END;

  -- 2. 作成者を管理者として追加
  INSERT INTO organization_members (
    organization_id,
    user_id,
    role
  ) VALUES (
    v_organization_id,
    p_user_id,
    'admin'
  )
  ON CONFLICT (organization_id, user_id) DO NOTHING;  -- 冪等性: 既に存在する場合は無視

  -- 3. サブスクリプションに組織IDを紐付け
  UPDATE subscriptions
  SET organization_id = v_organization_id
  WHERE id = p_subscription_id;

  -- 成功結果を返す
  v_result := json_build_object(
    'success', true,
    'organization_id', v_organization_id,
    'organization_name', p_organization_name,
    'plan_type', p_plan_type,
    'already_exists', false
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    -- エラーが発生した場合、トランザクション全体がロールバックされる
    RAISE EXCEPTION 'Organization creation failed: %', SQLERRM;
END;
$$;

-- ============================================================
-- 2. コメント更新
-- ============================================================

COMMENT ON FUNCTION create_organization_with_subscription IS
'既存のサブスクリプションを使用して組織を作成する。
冪等性を持つため、同じサブスクリプションで複数回呼び出しても安全。
既に組織が作成されている場合は、その組織情報を返す。
すべての処理（組織作成、メンバー追加、サブスクリプション更新）が
トランザクション内で実行されるため、途中で失敗した場合は
すべてロールバックされる。';

-- ============================================================
-- 完了
-- ============================================================
-- マイグレーション完了！
-- 関数が冪等になり、重複リクエストや再試行時のエラーを防ぎます。
-- ============================================================
