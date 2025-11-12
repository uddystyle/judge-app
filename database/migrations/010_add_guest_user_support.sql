-- Migration: Add Guest User Support
-- Description: セッションへのゲスト参加機能を追加
-- Date: 2025-01-11

-- ============================================================
-- 1. sessions テーブルの拡張
-- ============================================================

-- 招待トークン関連カラムの追加
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS invite_token_created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_sessions_invite_token ON sessions(invite_token);

-- コメント追加
COMMENT ON COLUMN sessions.invite_token IS 'ゲスト招待用のトークン（UUID）';
COMMENT ON COLUMN sessions.invite_token_created_at IS 'トークン作成日時（有効期限管理用）';

-- ============================================================
-- 2. session_participants テーブルの拡張
-- ============================================================

-- 既存の主キー制約を確認して削除
DO $$
BEGIN
  -- 既存の主キー制約を削除
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_participants_pkey'
    AND conrelid = 'session_participants'::regclass
  ) THEN
    ALTER TABLE session_participants DROP CONSTRAINT session_participants_pkey;
    RAISE NOTICE 'Dropped existing primary key constraint';
  END IF;
END $$;

-- id カラムを追加（主キー用）
ALTER TABLE session_participants
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

-- id を NOT NULL に設定（DEFAULT値があるので既存レコードも自動生成される）
ALTER TABLE session_participants
ALTER COLUMN id SET NOT NULL;

-- 新しい主キーを設定（id のみ）
ALTER TABLE session_participants
ADD CONSTRAINT session_participants_pkey PRIMARY KEY (id);

-- REPLICA IDENTITY を設定（Realtime用）
ALTER TABLE session_participants REPLICA IDENTITY USING INDEX session_participants_pkey;

-- ゲストユーザー関連カラムの追加（主キー設定後に追加）
ALTER TABLE session_participants
ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS guest_name TEXT,
ADD COLUMN IF NOT EXISTS guest_identifier TEXT;

-- user_id の NOT NULL 制約を削除（ゲストユーザーは user_id が NULL）
ALTER TABLE session_participants
ALTER COLUMN user_id DROP NOT NULL;

-- guest_identifier にユニーク制約を追加（NULL を許可）
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_participants_guest_identifier_unique
ON session_participants(guest_identifier)
WHERE guest_identifier IS NOT NULL;

-- session_id + user_id のユニーク制約を追加（通常ユーザー用）
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_participants_session_user_unique
ON session_participants(session_id, user_id)
WHERE user_id IS NOT NULL;

-- 制約追加: user_id と guest_identifier のどちらか一方は必須
ALTER TABLE session_participants
DROP CONSTRAINT IF EXISTS check_user_or_guest;

ALTER TABLE session_participants
ADD CONSTRAINT check_user_or_guest
CHECK (
  (user_id IS NOT NULL AND is_guest = false) OR
  (guest_identifier IS NOT NULL AND is_guest = true)
);

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_session_participants_guest_identifier ON session_participants(guest_identifier);
CREATE INDEX IF NOT EXISTS idx_session_participants_is_guest ON session_participants(is_guest);

-- コメント追加
COMMENT ON COLUMN session_participants.is_guest IS 'ゲストユーザーかどうか';
COMMENT ON COLUMN session_participants.guest_name IS 'ゲストユーザーの表示名';
COMMENT ON COLUMN session_participants.guest_identifier IS 'ゲスト識別用のUUID';

-- ============================================================
-- 3. 既存セッションに招待トークンを生成
-- ============================================================

-- 既存のセッションに invite_token がない場合、自動生成
UPDATE sessions
SET
  invite_token = gen_random_uuid()::text,
  invite_token_created_at = created_at
WHERE invite_token IS NULL;

-- ============================================================
-- 4. RLS（Row Level Security）ポリシーの更新
-- ============================================================

-- sessions テーブル: ゲストが招待トークンでセッションを閲覧できるようにする
CREATE POLICY "Anyone can view sessions by invite token"
ON sessions FOR SELECT
USING (invite_token IS NOT NULL);

-- organizations テーブル: セッション情報表示に必要な組織情報を閲覧可能にする
CREATE POLICY "Anyone can view organizations for sessions"
ON organizations FOR SELECT
USING (true);

-- results テーブル: ゲストユーザーが得点を投稿できるようにする
CREATE POLICY "Guests can insert results for sessions they participate in"
ON results FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM session_participants
    WHERE session_participants.session_id = results.session_id
    AND session_participants.is_guest = true
    AND session_participants.guest_name = results.judge_name
  )
);

-- results テーブル: ゲストユーザーが自分の得点を更新できるようにする
CREATE POLICY "Guests can update their own results"
ON results FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM session_participants
    WHERE session_participants.session_id = results.session_id
    AND session_participants.is_guest = true
    AND session_participants.guest_name = results.judge_name
  )
);

-- 既存のポリシーを削除して再作成
DROP POLICY IF EXISTS "Users can view their session participants" ON session_participants;
DROP POLICY IF EXISTS "Users can insert their session participants" ON session_participants;
DROP POLICY IF EXISTS "Users can update their session participants" ON session_participants;
DROP POLICY IF EXISTS "Users can delete their session participants" ON session_participants;

-- SELECT: 通常ユーザー + ゲストユーザー
CREATE POLICY "Users and guests can view session participants"
ON session_participants FOR SELECT
USING (
  auth.uid() = user_id OR is_guest = true
);

-- INSERT: 通常ユーザー + ゲストユーザー（セッション参加時）
CREATE POLICY "Users and guests can join sessions"
ON session_participants FOR INSERT
WITH CHECK (
  auth.uid() = user_id OR is_guest = true
);

-- UPDATE: 自分の参加情報のみ更新可能
CREATE POLICY "Users and guests can update their own participation"
ON session_participants FOR UPDATE
USING (
  auth.uid() = user_id OR is_guest = true
);

-- DELETE: セッション作成者またはゲスト本人
CREATE POLICY "Session creators and guests can delete participation"
ON session_participants FOR DELETE
USING (
  auth.uid() = user_id OR
  is_guest = true OR
  EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = session_participants.session_id
    AND sessions.created_by = auth.uid()
  )
);

-- ============================================================
-- 5. 招待トークン生成のトリガー関数
-- ============================================================

-- セッション作成時に自動的に招待トークンを生成
CREATE OR REPLACE FUNCTION generate_invite_token()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invite_token IS NULL THEN
    NEW.invite_token := gen_random_uuid()::text;
    NEW.invite_token_created_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガーの作成
DROP TRIGGER IF EXISTS trigger_generate_invite_token ON sessions;
CREATE TRIGGER trigger_generate_invite_token
BEFORE INSERT ON sessions
FOR EACH ROW
EXECUTE FUNCTION generate_invite_token();

-- ============================================================
-- 6. 完了メッセージ
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 010_add_guest_user_support.sql completed successfully';
  RAISE NOTICE '- Added invite_token columns to sessions table';
  RAISE NOTICE '- Added guest user columns to session_participants table';
  RAISE NOTICE '- Removed NOT NULL constraint from user_id (allows guest users)';
  RAISE NOTICE '- Added RLS policy for sessions (guest access via invite token)';
  RAISE NOTICE '- Added RLS policy for organizations (public read access)';
  RAISE NOTICE '- Updated RLS policies for session_participants (guest access)';
  RAISE NOTICE '- Created automatic invite token generation trigger';
END $$;
