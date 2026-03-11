-- ========================================
-- ゲストセッション隔離の検証スクリプト
-- ========================================
-- Usage: psql $DATABASE_URL -f scripts/verify-guest-session-isolation.sql

DO $$
DECLARE
  test_passed BOOLEAN := true;
  policy_count INT;
  dangerous_count INT;
  rls_enabled BOOLEAN; -- ✅ RLS有効化チェック用のboolean変数
  p RECORD; -- ✅ FIX: ループ用のRECORD型変数
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'ゲストセッション隔離テスト開始';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';

  -- ============================================
  -- Test 1: training_scores のRLSポリシー確認
  -- ============================================
  RAISE NOTICE 'Test 1: training_scores のゲストポリシー確認';
  RAISE NOTICE '----------------------------------------';

  -- SELECT ポリシー
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'training_scores'
    AND policyname LIKE '%own session%'
    AND 'anon' = ANY(roles::text[])
    AND cmd = 'SELECT'
    AND qual::text LIKE '%user_metadata%';

  IF policy_count >= 1 THEN
    RAISE NOTICE '✅ SELECT: "Guests can view training scores in their own session" が存在';
  ELSE
    RAISE WARNING '❌ SELECT: training_scores のゲストSELECTポリシーが不足';
    test_passed := false;
  END IF;

  -- INSERT ポリシー
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'training_scores'
    AND policyname LIKE '%own session%'
    AND 'anon' = ANY(roles::text[])
    AND cmd = 'INSERT'
    AND with_check::text LIKE '%user_metadata%';

  IF policy_count >= 1 THEN
    RAISE NOTICE '✅ INSERT: "Guests can insert training_scores in their own session" が存在';
  ELSE
    RAISE WARNING '❌ INSERT: training_scores のゲストINSERTポリシーが不足';
    test_passed := false;
  END IF;

  -- UPDATE ポリシー
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'training_scores'
    AND policyname LIKE '%own training_scores%'
    AND 'anon' = ANY(roles::text[])
    AND cmd = 'UPDATE'
    AND qual::text LIKE '%user_metadata%';

  IF policy_count >= 1 THEN
    RAISE NOTICE '✅ UPDATE: "Guests can update their own training_scores" が存在';
  ELSE
    RAISE WARNING '❌ UPDATE: training_scores のゲストUPDATEポリシーが不足';
    test_passed := false;
  END IF;

  -- DELETE ポリシー
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'training_scores'
    AND policyname LIKE '%own training_scores%'
    AND 'anon' = ANY(roles::text[])
    AND cmd = 'DELETE'
    AND qual::text LIKE '%user_metadata%';

  IF policy_count >= 1 THEN
    RAISE NOTICE '✅ DELETE: "Guests can delete their own training_scores" が存在';
  ELSE
    RAISE WARNING '❌ DELETE: training_scores のゲストDELETEポリシーが不足';
    test_passed := false;
  END IF;

  RAISE NOTICE '';

  -- ============================================
  -- Test 2: results のRLSポリシー確認
  -- ============================================
  RAISE NOTICE 'Test 2: results のゲストポリシー確認';
  RAISE NOTICE '----------------------------------------';

  -- SELECT ポリシー
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'results'
    AND policyname LIKE '%own session%'
    AND 'anon' = ANY(roles::text[])
    AND cmd = 'SELECT'
    AND qual::text LIKE '%user_metadata%';

  IF policy_count >= 1 THEN
    RAISE NOTICE '✅ SELECT: "Guests can view results in their own session" が存在';
  ELSE
    RAISE WARNING '❌ SELECT: results のゲストSELECTポリシーが不足';
    test_passed := false;
  END IF;

  -- INSERT ポリシー
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'results'
    AND policyname LIKE '%own session%'
    AND 'anon' = ANY(roles::text[])
    AND cmd = 'INSERT'
    AND with_check::text LIKE '%user_metadata%';

  IF policy_count >= 1 THEN
    RAISE NOTICE '✅ INSERT: "Guests can insert results in their own session" が存在';
  ELSE
    RAISE WARNING '❌ INSERT: results のゲストINSERTポリシーが不足';
    test_passed := false;
  END IF;

  -- UPDATE ポリシー
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'results'
    AND policyname LIKE '%own results%'
    AND 'anon' = ANY(roles::text[])
    AND cmd = 'UPDATE'
    AND qual::text LIKE '%user_metadata%';

  IF policy_count >= 1 THEN
    RAISE NOTICE '✅ UPDATE: "Guests can update their own results" が存在';
  ELSE
    RAISE WARNING '❌ UPDATE: results のゲストUPDATEポリシーが不足';
    test_passed := false;
  END IF;

  RAISE NOTICE '';

  -- ============================================
  -- Test 3: 危険なポリシーが残っていないか確認
  -- ============================================
  RAISE NOTICE 'Test 3: 危険なポリシーのチェック';
  RAISE NOTICE '----------------------------------------';

  -- is_guest = true のみで user_metadata がないポリシー
  SELECT COUNT(*) INTO dangerous_count
  FROM pg_policies
  WHERE tablename IN ('training_scores', 'results')
    AND 'anon' = ANY(roles::text[])
    AND (
      qual::text LIKE '%is_guest%'
      OR with_check::text LIKE '%is_guest%'
    )
    AND qual::text NOT LIKE '%user_metadata%'
    AND with_check::text NOT LIKE '%user_metadata%';

  IF dangerous_count = 0 THEN
    RAISE NOTICE '✅ 危険なポリシー（is_guest のみ）は存在しない';
  ELSE
    RAISE WARNING '❌ 危険なポリシーが % 個残っています！', dangerous_count;
    RAISE WARNING '   以下のポリシーを確認してください:';

    -- 危険なポリシーをリスト表示
    FOR p IN
      SELECT policyname
      FROM pg_policies
      WHERE tablename IN ('training_scores', 'results')
        AND 'anon' = ANY(roles::text[])
        AND (
          qual::text LIKE '%is_guest%'
          OR with_check::text LIKE '%is_guest%'
        )
        AND qual::text NOT LIKE '%user_metadata%'
        AND with_check::text NOT LIKE '%user_metadata%'
    LOOP
      RAISE WARNING '     - %', p.policyname;
    END LOOP;

    test_passed := false;
  END IF;

  RAISE NOTICE '';

  -- ============================================
  -- Test 4: RLSが有効化されていることを確認
  -- ============================================
  RAISE NOTICE 'Test 4: RLS有効化確認';
  RAISE NOTICE '----------------------------------------';

  -- training_scores
  SELECT relrowsecurity INTO rls_enabled
  FROM pg_class
  WHERE relname = 'training_scores';

  IF rls_enabled THEN
    RAISE NOTICE '✅ training_scores のRLSが有効';
  ELSE
    RAISE WARNING '❌ training_scores のRLSが無効！';
    test_passed := false;
  END IF;

  -- results
  SELECT relrowsecurity INTO rls_enabled
  FROM pg_class
  WHERE relname = 'results';

  IF rls_enabled THEN
    RAISE NOTICE '✅ results のRLSが有効';
  ELSE
    RAISE WARNING '❌ results のRLSが無効！';
    test_passed := false;
  END IF;

  RAISE NOTICE '';

  -- ============================================
  -- Test 5: 認証ユーザーのresults UPDATEポリシー確認
  -- ============================================
  RAISE NOTICE 'Test 5: 認証ユーザーのresults UPDATEポリシー確認';
  RAISE NOTICE '----------------------------------------';

  -- session_participants チェックがあるか確認
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE tablename = 'results'
    AND policyname LIKE '%update their own results%'
    AND 'authenticated' = ANY(roles::text[])
    AND cmd = 'UPDATE'
    AND qual::text LIKE '%session_participants%';

  IF policy_count >= 1 THEN
    RAISE NOTICE '✅ UPDATE: "Authenticated users can update their own results" にsession_participantsチェックあり';
    RAISE NOTICE '   セキュリティ: クロスセッション攻撃を防止';
  ELSE
    RAISE WARNING '❌ UPDATE: results の認証ユーザーUPDATEポリシーにsession_participantsチェックなし';
    RAISE WARNING '   リスク: クロスセッション攻撃、同名ユーザー衝突';
    test_passed := false;
  END IF;

  RAISE NOTICE '';

  -- ============================================
  -- 最終結果
  -- ============================================
  RAISE NOTICE '========================================';
  IF test_passed THEN
    RAISE NOTICE '✅ 全テスト合格';
    RAISE NOTICE '';
    RAISE NOTICE 'ゲストセッション隔離 + 認証ユーザーセキュリティが正しく実装されています。';
    RAISE NOTICE '';
    RAISE NOTICE 'セキュリティ改善:';
    RAISE NOTICE '1. ゲスト: JWT user_metadata ベースのセッション隔離';
    RAISE NOTICE '2. 認証ユーザー: session_participants チェック追加';
    RAISE NOTICE '3. クロスセッション攻撃を防止';
    RAISE NOTICE '';
    RAISE NOTICE '次のステップ:';
    RAISE NOTICE '1. サーバーサイドでJWT発行が正しく動作することを確認';
    RAISE NOTICE '2. 複数セッションで実際にゲストがクロスセッションアクセスできないことをテスト';
    RAISE NOTICE '3. Realtime購読でもRLSが適用されることを確認';
    RAISE NOTICE '';
    RAISE NOTICE '将来の改善:';
    RAISE NOTICE '- results テーブルに judge_id (UUID) カラム追加で完全な所有権チェック';
  ELSE
    RAISE WARNING '❌ テスト失敗';
    RAISE WARNING '';
    RAISE WARNING 'RLSポリシーを確認してください。';
    RAISE WARNING 'マイグレーション 1000_secure_guest_session_isolation.sql が正しく適用されているか確認してください。';
  END IF;
  RAISE NOTICE '========================================';
END $$;

-- ============================================
-- 詳細: 現在のゲスト用RLSポリシー一覧
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '現在のゲスト用RLSポリシー一覧:';
  RAISE NOTICE '========================================';
END $$;

SELECT
  tablename AS "テーブル",
  policyname AS "ポリシー名",
  cmd AS "操作",
  CASE
    WHEN qual::text LIKE '%user_metadata%' OR with_check::text LIKE '%user_metadata%' THEN '✅ JWT-based'
    WHEN qual::text LIKE '%is_guest%' OR with_check::text LIKE '%is_guest%' THEN '⚠️ is_guest flag'
    ELSE '🔍 Other'
  END AS "セキュリティレベル",
  CASE
    WHEN LENGTH(qual::text) > 50 THEN SUBSTRING(qual::text, 1, 50) || '...'
    ELSE qual::text
  END AS "条件（抜粋）"
FROM pg_policies
WHERE tablename IN ('training_scores', 'results')
  AND 'anon' = ANY(roles::text[])
ORDER BY tablename, cmd, policyname;
