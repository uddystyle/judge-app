-- Migration: Fix sessions.id and related tables Type Mismatch (UUID to bigint)
-- Description: 開発環境の sessions.id を UUID から bigint に戻して本番環境と統一
-- Date: 2025-11-12
-- WARNING: This will delete ALL existing data in sessions and related tables

-- ============================================================
-- 1. 既存データの確認と警告
-- ============================================================

DO $$
DECLARE
  sessions_count INTEGER;
  events_count INTEGER;
  participants_count INTEGER;
  results_count INTEGER;
  prompts_count INTEGER;
  session_participants_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO sessions_count FROM sessions;
  SELECT COUNT(*) INTO events_count FROM custom_events;
  SELECT COUNT(*) INTO participants_count FROM participants;
  SELECT COUNT(*) INTO results_count FROM results;
  SELECT COUNT(*) INTO prompts_count FROM scoring_prompts;
  SELECT COUNT(*) INTO session_participants_count FROM session_participants;

  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'WARNING: This migration will delete ALL existing session data!';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'sessions: % records', sessions_count;
  RAISE NOTICE 'custom_events: % records', events_count;
  RAISE NOTICE 'participants: % records', participants_count;
  RAISE NOTICE 'results: % records', results_count;
  RAISE NOTICE 'scoring_prompts: % records', prompts_count;
  RAISE NOTICE 'session_participants: % records', session_participants_count;
  RAISE NOTICE '=================================================================';
END $$;

-- ============================================================
-- 2. 全てのRLSポリシーを一時的に削除（動的に全削除）
-- ============================================================

-- sessions.id に依存する可能性のある全てのポリシーを削除
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('sessions', 'custom_events', 'participants', 'session_participants', 'results', 'scoring_prompts')
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    RAISE NOTICE 'Dropped policy % on %.%', r.policyname, r.schemaname, r.tablename;
  END LOOP;
END $$;

-- 念のため、個別にも削除を試みる
-- sessions テーブルのポリシー
DROP POLICY IF EXISTS "Session creators can delete their sessions" ON sessions;
DROP POLICY IF EXISTS "Session creators can update their sessions" ON sessions;
DROP POLICY IF EXISTS "Session creators can view their sessions" ON sessions;
DROP POLICY IF EXISTS "Session participants can view sessions" ON sessions;
DROP POLICY IF EXISTS "Users can view sessions they created or participate in" ON sessions;
DROP POLICY IF EXISTS "Users can create sessions" ON sessions;
DROP POLICY IF EXISTS "Organization members can view sessions" ON sessions;
DROP POLICY IF EXISTS "Organization members can manage sessions" ON sessions;

-- session_participants テーブルのポリシー
DROP POLICY IF EXISTS "Session creators can insert participants" ON session_participants;
DROP POLICY IF EXISTS "Session creators can delete participants" ON session_participants;
DROP POLICY IF EXISTS "Session creators can view participants" ON session_participants;
DROP POLICY IF EXISTS "Session creators and guests can delete participation" ON session_participants;
DROP POLICY IF EXISTS "Anyone can view session participants" ON session_participants;
DROP POLICY IF EXISTS "Authenticated users can view session participants" ON session_participants;
DROP POLICY IF EXISTS "Anonymous users can view session participants" ON session_participants;

-- custom_events テーブルのポリシー
DROP POLICY IF EXISTS "Session participants can view custom events" ON custom_events;
DROP POLICY IF EXISTS "Session creators can insert custom events" ON custom_events;
DROP POLICY IF EXISTS "Session creators can update custom events" ON custom_events;
DROP POLICY IF EXISTS "Session creators can delete custom events" ON custom_events;
DROP POLICY IF EXISTS "Authenticated users can view custom events" ON custom_events;
DROP POLICY IF EXISTS "Authenticated users can insert custom events" ON custom_events;
DROP POLICY IF EXISTS "Authenticated users can update custom events" ON custom_events;
DROP POLICY IF EXISTS "Authenticated users can delete custom events" ON custom_events;

-- participants テーブルのポリシー
DROP POLICY IF EXISTS "Session participants can view participants" ON participants;
DROP POLICY IF EXISTS "Session creators can insert participants" ON participants;
DROP POLICY IF EXISTS "Session creators can update participants" ON participants;
DROP POLICY IF EXISTS "Session creators can delete participants" ON participants;

-- results テーブルのポリシー
DROP POLICY IF EXISTS "Session participants can view results" ON results;
DROP POLICY IF EXISTS "Session participants can insert results" ON results;
DROP POLICY IF EXISTS "Session participants can update results" ON results;
DROP POLICY IF EXISTS "Session participants can delete results" ON results;
DROP POLICY IF EXISTS "Authenticated users can view results" ON results;
DROP POLICY IF EXISTS "Authenticated users can insert results" ON results;
DROP POLICY IF EXISTS "Authenticated users can update results" ON results;
DROP POLICY IF EXISTS "Authenticated users can delete results" ON results;
DROP POLICY IF EXISTS "Anonymous users can view results" ON results;
DROP POLICY IF EXISTS "Anonymous users can insert results" ON results;
DROP POLICY IF EXISTS "Anonymous users can update results" ON results;
DROP POLICY IF EXISTS "Session participants and guests can view results" ON results;
DROP POLICY IF EXISTS "Session participants and guests can insert results" ON results;
DROP POLICY IF EXISTS "Session participants and guests can update results" ON results;
DROP POLICY IF EXISTS "Session participants and guests can delete results" ON results;
DROP POLICY IF EXISTS "chief_judge_can_delete_results" ON results;
DROP POLICY IF EXISTS "chief_judge_can_update_results" ON results;
DROP POLICY IF EXISTS "chief_judge_can_view_results" ON results;
DROP POLICY IF EXISTS "chief_judge_can_insert_results" ON results;

-- scoring_prompts テーブルのポリシー
DROP POLICY IF EXISTS "Session participants can view scoring prompts" ON scoring_prompts;
DROP POLICY IF EXISTS "Session creators can manage scoring prompts" ON scoring_prompts;
DROP POLICY IF EXISTS "Authenticated users can view scoring prompts" ON scoring_prompts;
DROP POLICY IF EXISTS "Authenticated users can manage scoring prompts" ON scoring_prompts;

-- ============================================================
-- 3. 全ての外部キー制約を削除
-- ============================================================

-- custom_events
ALTER TABLE custom_events DROP CONSTRAINT IF EXISTS custom_events_session_id_fkey;

-- participants
ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_session_id_fkey;

-- results (session_idがある場合)
ALTER TABLE results DROP CONSTRAINT IF EXISTS results_session_id_fkey;

-- scoring_prompts (既に UUID に変更済みのはず)
ALTER TABLE scoring_prompts DROP CONSTRAINT IF EXISTS scoring_prompts_session_id_fkey;

-- session_participants
ALTER TABLE session_participants DROP CONSTRAINT IF EXISTS session_participants_session_id_fkey;

-- sessions自体の外部キー制約
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_active_prompt_id_fkey;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_chief_judge_id_fkey;

-- ============================================================
-- 4. 全ての関連データを削除
-- ============================================================

TRUNCATE TABLE custom_events CASCADE;
TRUNCATE TABLE participants CASCADE;
TRUNCATE TABLE results CASCADE;
TRUNCATE TABLE scoring_prompts CASCADE;
TRUNCATE TABLE session_participants CASCADE;
TRUNCATE TABLE sessions CASCADE;

-- ============================================================
-- 5. sessions.id を UUID から bigint に変更（本番環境と統一）
-- ============================================================

-- デフォルト値を先に削除（UUID生成関数は bigint にキャストできないため）
ALTER TABLE sessions
ALTER COLUMN id DROP DEFAULT;

-- idカラムの型を bigint に変更
ALTER TABLE sessions
ALTER COLUMN id TYPE bigint USING NULL;

-- シーケンスを作成してデフォルト値を設定（本番環境と同じ）
CREATE SEQUENCE IF NOT EXISTS sessions_id_seq;
ALTER TABLE sessions
ALTER COLUMN id SET DEFAULT nextval('sessions_id_seq'::regclass);

-- active_prompt_id のデフォルト値も削除（エラーが出ても続行）
DO $$
BEGIN
  ALTER TABLE sessions ALTER COLUMN active_prompt_id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'active_prompt_id has no default value';
END $$;

-- active_prompt_id を bigint に変更（本番環境と統一）
ALTER TABLE sessions
ALTER COLUMN active_prompt_id TYPE bigint USING NULL;

-- ============================================================
-- 6. custom_events テーブルの修正
-- ============================================================

-- デフォルト値を先に削除（UUID生成関数がある場合）
DO $$
BEGIN
  ALTER TABLE custom_events ALTER COLUMN id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'custom_events.id has no default value';
END $$;

-- session_idカラムの型を bigint に確認（既に bigint のはず）
ALTER TABLE custom_events
ALTER COLUMN session_id TYPE bigint USING NULL;

-- idカラムを bigint に変更
ALTER TABLE custom_events
ALTER COLUMN id TYPE bigint USING NULL;

-- デフォルト値を設定（シーケンス）
CREATE SEQUENCE IF NOT EXISTS custom_events_id_seq;
ALTER TABLE custom_events
ALTER COLUMN id SET DEFAULT nextval('custom_events_id_seq'::regclass);

-- ============================================================
-- 7. participants テーブルの修正
-- ============================================================

-- デフォルト値を先に削除（UUID生成関数がある場合）
DO $$
BEGIN
  ALTER TABLE participants ALTER COLUMN id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'participants.id has no default value';
END $$;

-- session_idカラムの型を bigint に確認（既に bigint のはず）
ALTER TABLE participants
ALTER COLUMN session_id TYPE bigint USING NULL;

-- idカラムを bigint に変更
ALTER TABLE participants
ALTER COLUMN id TYPE bigint USING NULL;

-- デフォルト値を設定（シーケンス）
CREATE SEQUENCE IF NOT EXISTS participants_id_seq;
ALTER TABLE participants
ALTER COLUMN id SET DEFAULT nextval('participants_id_seq'::regclass);

-- ============================================================
-- 8. results テーブルの修正（session_id がある場合）
-- ============================================================

-- session_idカラムの型を bigint に確認（既に bigint のはず）
ALTER TABLE results
ALTER COLUMN session_id TYPE bigint USING NULL;

-- ============================================================
-- 9. session_participants テーブルの修正
-- ============================================================

-- session_idカラムの型を bigint に確認（既に bigint のはず）
ALTER TABLE session_participants
ALTER COLUMN session_id TYPE bigint USING NULL;

-- id は uuid のまま（本番環境と同じ）

-- ============================================================
-- 10. scoring_prompts テーブルの修正
-- ============================================================

-- デフォルト値を先に削除（UUID生成関数がある場合）
DO $$
BEGIN
  ALTER TABLE scoring_prompts ALTER COLUMN id DROP DEFAULT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'scoring_prompts.id has no default value';
END $$;

-- session_idカラムの型を bigint に変更
ALTER TABLE scoring_prompts
ALTER COLUMN session_id TYPE bigint USING NULL;

-- idカラムを bigint に変更
ALTER TABLE scoring_prompts
ALTER COLUMN id TYPE bigint USING NULL;

-- デフォルト値を設定（シーケンス）
CREATE SEQUENCE IF NOT EXISTS scoring_prompts_id_seq;
ALTER TABLE scoring_prompts
ALTER COLUMN id SET DEFAULT nextval('scoring_prompts_id_seq'::regclass);

-- ============================================================
-- 11. 外部キー制約を再作成
-- ============================================================

-- custom_events
ALTER TABLE custom_events
ADD CONSTRAINT custom_events_session_id_fkey
FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

-- participants
ALTER TABLE participants
ADD CONSTRAINT participants_session_id_fkey
FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

-- results
ALTER TABLE results
ADD CONSTRAINT results_session_id_fkey
FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

-- scoring_prompts
ALTER TABLE scoring_prompts
ADD CONSTRAINT scoring_prompts_session_id_fkey
FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

-- session_participants
ALTER TABLE session_participants
ADD CONSTRAINT session_participants_session_id_fkey
FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

-- sessions の active_prompt_id
ALTER TABLE sessions
ADD CONSTRAINT sessions_active_prompt_id_fkey
FOREIGN KEY (active_prompt_id) REFERENCES scoring_prompts(id) ON DELETE SET NULL;

-- ============================================================
-- 12. RLSポリシーを再作成
-- ============================================================

-- sessions テーブルのポリシー
CREATE POLICY "Organization members can view sessions"
  ON sessions FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Organization members can manage sessions"
  ON sessions FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

-- session_participants テーブルのポリシー
CREATE POLICY "Authenticated users can view session participants"
  ON session_participants FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Anonymous users can view session participants"
  ON session_participants FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Session creators and guests can delete participation"
  ON session_participants FOR DELETE
  USING (
    user_id = auth.uid() OR
    is_guest = true
  );

-- custom_events テーブルのポリシー
CREATE POLICY "Authenticated users can view custom events"
  ON custom_events FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert custom events"
  ON custom_events FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update custom events"
  ON custom_events FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete custom events"
  ON custom_events FOR DELETE
  TO authenticated
  USING (true);

-- participants テーブルのポリシー（必要に応じて追加）

-- results テーブルのポリシー
CREATE POLICY "Authenticated users can view results"
  ON results FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert results"
  ON results FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update results"
  ON results FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete results"
  ON results FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Anonymous users can view results"
  ON results FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous users can insert results"
  ON results FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous users can update results"
  ON results FOR UPDATE
  TO anon
  USING (true);

-- scoring_prompts テーブルのポリシー
CREATE POLICY "Authenticated users can view scoring prompts"
  ON scoring_prompts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage scoring prompts"
  ON scoring_prompts FOR ALL
  TO authenticated
  USING (true);

-- ============================================================
-- 13. 完了メッセージ
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration 030_fix_tournament_tables_session_id_type.sql completed';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '- Changed sessions.id from UUID to bigint (to match production)';
  RAISE NOTICE '- Changed sessions.active_prompt_id to bigint';
  RAISE NOTICE '- Changed scoring_prompts.id and session_id from UUID to bigint';
  RAISE NOTICE '- Confirmed custom_events.id and session_id are bigint';
  RAISE NOTICE '- Confirmed participants.id and session_id are bigint';
  RAISE NOTICE '- Confirmed results.session_id is bigint';
  RAISE NOTICE '- Confirmed session_participants.session_id is bigint';
  RAISE NOTICE '- Recreated all foreign key constraints';
  RAISE NOTICE '- Recreated all RLS policies';
  RAISE NOTICE '- All existing records were deleted';
  RAISE NOTICE '- Development environment now matches production environment';
  RAISE NOTICE '=================================================================';
END $$;
