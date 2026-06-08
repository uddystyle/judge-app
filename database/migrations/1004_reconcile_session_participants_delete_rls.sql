-- Migration: Reconcile session_participants DELETE RLS to a single canonical policy
-- Date: 2026-06-09
--
-- 背景:
--   本番には過去マイグレ由来のレガシーな重複 DELETE ポリシーが残存し、その中の
--     "Session creators and guests can delete participation" {public} (... OR is_guest = true)
--   が「誰でも任意セッションのゲストを削除できる」IDOR を作っていた（1002 は名前不一致で未除去）。
--   さらに is_guest=false の正規判定員を主催者が削除する正規フローはRLSで0行になり実質機能していなかった。
--
-- 本マイグレは DELETE ポリシーのみを対象に、名前ドリフトに依存せず全削除 → 正規1本へ収束させる。
--
-- ✅ アプリ非依存: 本マイグレは安全にいつでも適用できる（ゲストINSORTの service role 化に依存しない）。
--    正規の削除フロー（主催者/主任・組織管理者・本人・ゲスト本人JWT）は全て新ポリシーがカバーする。
--    ロールバック等のサーバ削除は service role（RLSバイパス）のため対象外。

-- ============================================================
-- 0. セッション管理者判定ヘルパー（SECURITY DEFINER = RLSバイパス、再帰回避）
--    sessions.id / session_participants.session_id は bigint（migration 030 で UUID→bigint）。
-- ============================================================
DROP FUNCTION IF EXISTS can_manage_session_participants(UUID);

CREATE OR REPLACE FUNCTION can_manage_session_participants(p_session_id BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM sessions s
    WHERE s.id = p_session_id
      AND (
        s.created_by = auth.uid()
        OR s.chief_judge_id = auth.uid()
        OR (s.organization_id IS NOT NULL AND is_organization_admin(s.organization_id))
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================================
-- 1. DELETE ポリシーを全削除（名前に依存しない）
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
      AND cmd = 'DELETE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON session_participants', r.policyname);
  END LOOP;
END $$;

-- ============================================================
-- 2. 正規 DELETE ポリシー（本人・ゲスト本人(JWT)・主催者/主任・組織管理者のみ）
-- ============================================================
CREATE POLICY "Owner, session manager, or org admin can delete participation"
  ON session_participants FOR DELETE
  TO authenticated
  USING (
    (auth.uid() = user_id)
    OR (
      is_guest = true
      AND guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
    )
    OR can_manage_session_participants(session_id)
  );

DO $$
BEGIN
  RAISE NOTICE '1004 completed: session_participants DELETE を正規1本に収束（IDOR解消・アプリ非依存）';
END $$;
