-- Migration: Harden session_participants RLS (close participant-injection & cross-guest-rename)
-- Date: 2026-06-09
--
-- 背景（堅牢性監査 High #1）:
--   * migration 031 で INSERT ポリシーが anon/authenticated ともに WITH CHECK (true)
--     となっており、ブラウザに同梱される公開 anon キーから任意の session_id を持つ
--     参加者行を直接INSERTできた。これによりアプリ層のみで実施していた
--     is_locked / is_accepting_participants / 検定員数上限 のチェックを全てバイパス可能だった。
--   * migration 010 の UPDATE ポリシーは USING (auth.uid() = user_id OR is_guest = true) で、
--     is_guest=true の行は「誰でも」更新できた（TO句なし=全ロール、WITH CHECKなし）。
--     これにより別セッションのゲストを勝手に改名でき、スコア帰属の汚染にも波及した。
--     010以降この UPDATE ポリシーは一度も再スコープされていない。
--
-- 対応方針:
--   * ゲスト行はサーバ側（service role）でサーバチェック通過後にのみINSERTする実装へ変更したため、
--     anon からの直接INSORTは不要 → anon INSERT ポリシーを削除（=拒否）。
--   * authenticated は「自分自身を非ゲスト参加者として」追加する場合のみ許可。
--   * UPDATE は本人(user_id=auth.uid())、またはゲストは JWT クレームの guest_identifier 一致時のみ許可
--     （migration 1001 の results/training_scores ハードニングと同じ方式）。
--
-- 注意: service role（SUPABASE_SERVICE_ROLE_KEY）は RLS をバイパスするため、
--       サーバ側のゲスト登録・組織メンバー自動追加（api/sessions 等）は影響を受けない。

-- ============================================================
-- INSERT ポリシー
-- ============================================================
DROP POLICY IF EXISTS "Anonymous users can insert session participants" ON session_participants;
DROP POLICY IF EXISTS "Authenticated users can insert session participants" ON session_participants;

-- 認証ユーザーは「自分自身」を非ゲスト参加者として追加できる場合のみ許可。
-- （セッション作成者の自動追加・組織メンバーの自動追加はいずれも user_id=auth.uid()・is_guest=false。
--  ゲスト登録および api/sessions の作成者追加は service role 経由のため RLS をバイパスする）
CREATE POLICY "Authenticated users can join sessions as themselves"
  ON session_participants FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_guest = false);

-- anon 用の INSERT ポリシーは作成しない。
-- ゲスト参加者はサーバ側の service role が、ロック/受付終了/検定員上限チェックの
-- 通過後にのみINSERTする。

-- ============================================================
-- UPDATE ポリシー
-- ============================================================
DROP POLICY IF EXISTS "Users and guests can update their own participation" ON session_participants;

CREATE POLICY "Users and guests can update their own participation"
  ON session_participants FOR UPDATE
  USING (
    (auth.uid() = user_id)
    OR (
      is_guest = true
      AND guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
    )
  )
  WITH CHECK (
    (auth.uid() = user_id)
    OR (
      is_guest = true
      AND guest_identifier = (auth.jwt() -> 'user_metadata' ->> 'guest_identifier')
    )
  );

-- 完了メッセージ
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 1002_harden_session_participants_rls.sql completed';
  RAISE NOTICE '- INSERT: anon 拒否 / authenticated は自分自身(非ゲスト)のみ';
  RAISE NOTICE '- UPDATE: 本人 または JWTクレーム一致のゲストのみ';
  RAISE NOTICE '=================================================================';
END $$;
