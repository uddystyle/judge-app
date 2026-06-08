-- Migration: Harden session_participants DELETE RLS (close cross-session guest deletion)
-- Date: 2026-06-09
--
-- 背景（1002 適用後の検証で発見した同種の穴）:
--   既存の DELETE ポリシー "Session creators and guests can delete participation" は
--     roles = {public}（anon含む） / USING ((user_id = auth.uid()) OR (is_guest = true))
--   となっており、1002 で塞いだ UPDATE と全く同じ欠陥がDELETEに残っていた。
--     * is_guest=true の行は「誰でも」削除でき、任意セッションのゲストを退出/参加者数操作できる（IDOR）。
--     * 一方で is_guest=false の正規判定員を「主催者」が削除する正規フローは
--       (user_id=auth.uid()) にも (is_guest=true) にも該当せず RLS で 0 行削除になり、
--       実質的に機能していなかった（latent bug）。
--
-- 正規の削除者:
--   * 本人（user_id = auth.uid()）
--   * ゲスト本人（JWTクレームの guest_identifier 一致）
--   * セッション主催者 / 主任（sessions.created_by / chief_judge_id）
--       — src/routes/session/[id]/details の removeGuest/removeParticipant/deleteSession
--   * 当該組織の管理者（is_organization_admin）
--       — src/routes/api/sessions/[id]/permanent（premium組織のadminによる完全削除）
--   * ロールバック等のサーバ処理は service role（RLS迂回）のため本ポリシー対象外
--
-- 実装: RLS再帰や sessions の SELECT-RLS 依存を避けるため、判定を SECURITY DEFINER 関数に閉じ込める。

-- ============================================================
-- 1. セッション管理者判定ヘルパー（SECURITY DEFINER = RLSバイパス）
-- ============================================================
-- 注意: sessions.id / session_participants.session_id は bigint（migration 030 で UUID→bigint）。
--       organizations.id のみ UUID。
-- 直前の試行で誤って作成された UUID 版が残っている場合に備えてDROPしてから作り直す。
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
-- 2. DELETE ポリシーを再スコープ
-- ============================================================
DROP POLICY IF EXISTS "Session creators and guests can delete participation" ON session_participants;
DROP POLICY IF EXISTS "Owner, session manager, or org admin can delete participation" ON session_participants;

-- anon（JWTなし=APIキーのみ）には DELETE を一切許可しない。
-- ゲストは signInAnonymously 後 'authenticated' ロールになるため、本ポリシーで自分の行を削除可能。
CREATE POLICY "Owner, session manager, or org admin can delete participation"
  ON session_participants FOR DELETE
  TO authenticated
  USING (
    -- 本人の参加行
    (auth.uid() = user_id)
    -- 自分（ゲスト）の参加行（JWTクレーム照合）
    OR (
      is_guest = true
      AND guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
    )
    -- セッション主催者/主任・組織管理者は配下の参加者を削除可
    OR can_manage_session_participants(session_id)
  );

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 1003_harden_session_participants_delete_rls.sql completed';
  RAISE NOTICE '- DELETE: anon拒否 / 本人・ゲスト本人(JWT)・主催者/主任・組織管理者のみ';
  RAISE NOTICE '- 旧 (is_guest=true) 無条件削除を撤廃（IDOR解消）';
  RAISE NOTICE '=================================================================';
END $$;
