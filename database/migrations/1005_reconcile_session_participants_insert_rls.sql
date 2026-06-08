-- Migration: Reconcile session_participants INSERT RLS to a single canonical policy
-- Date: 2026-06-09
--
-- 背景:
--   本番には "Users and guests can join sessions" {public} WITH CHECK(... OR is_guest = true) 等の
--   レガシーなゆるい INSERT ポリシーが残存し、公開anonキーで任意セッションにゲスト参加者を
--   注入できる IDOR を作っていた（1002 は名前不一致で未除去）。
--
-- 本マイグレは INSERT ポリシーのみを対象に、名前ドリフトに依存せず全削除 → 正規1本へ収束させる。
--
-- ⚠️ デプロイ依存（重要）:
--   適用後、ゲスト参加者の INSERT は service role（サーバ側）経由のみになる。
--   アプリ側（コミット 36a7e37: ゲストINSERTを supabaseAdmin 経由へ。feature→main へマージし本番デプロイ）が
--   本番で稼働してから本マイグレを適用すること。
--   旧アプリ（anonキーで直接INSERT）のまま適用すると、参加コード/招待リンク両方のゲスト参加が失敗する。

-- ============================================================
-- 1. INSERT ポリシーを全削除（名前に依存しない）
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'session_participants'
      AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON session_participants', r.policyname);
  END LOOP;
END $$;

-- ============================================================
-- 2. 正規 INSERT ポリシー（認証ユーザーが自分自身を非ゲストで追加する場合のみ）
--    ゲスト登録は service role 経由（RLSバイパス）でサーバチェック通過後にのみ実行する。
-- ============================================================
CREATE POLICY "Authenticated users can join sessions as themselves"
  ON session_participants FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_guest = false);

DO $$
BEGIN
  RAISE NOTICE '1005 completed: session_participants INSERT を正規1本に収束（要・アプリデプロイ済み）';
END $$;
