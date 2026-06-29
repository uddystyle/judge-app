-- ============================================================
-- Phase 0: 既存データのクリーンアップ
-- ============================================================
-- 本番環境未稼働のため、既存データを削除して再構築します
-- ============================================================
-- 実行日: 2025-11-07
-- 説明: 組織ベース設計への完全移行のための既存データクリーンアップ
-- ============================================================

-- ============================================================
-- 注意事項
-- ============================================================
-- このマイグレーションは既存のすべてのデータを削除します。
-- 本番環境で実行する前に必ずバックアップを取得してください。
-- ============================================================

-- ============================================================
-- 1. セッション関連データの削除
-- ============================================================

-- 大会モード関連（存在する場合のみ削除）
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'custom_events') THEN
    TRUNCATE TABLE custom_events CASCADE;
  END IF;

  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tournament_athletes') THEN
    TRUNCATE TABLE tournament_athletes CASCADE;
  END IF;
END $$;

-- 研修モード関連（存在する場合のみ削除）
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'training_scores') THEN
    TRUNCATE TABLE training_scores CASCADE;
  END IF;

  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'training_events') THEN
    TRUNCATE TABLE training_events CASCADE;
  END IF;

  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'training_sessions') THEN
    TRUNCATE TABLE training_sessions CASCADE;
  END IF;
END $$;

-- 採点関連（存在する場合のみ削除）
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'scores') THEN
    TRUNCATE TABLE scores CASCADE;
  END IF;

  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'participants') THEN
    TRUNCATE TABLE participants CASCADE;
  END IF;
END $$;

-- セッション参加者（存在する場合のみ削除）
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'session_participants') THEN
    TRUNCATE TABLE session_participants CASCADE;
  END IF;
END $$;

-- セッション（存在する場合のみ削除）
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sessions') THEN
    TRUNCATE TABLE sessions CASCADE;
  END IF;
END $$;

-- ============================================================
-- 2. 組織関連データの削除（既に作成されている場合）
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'invitation_uses') THEN
    TRUNCATE TABLE invitation_uses CASCADE;
  END IF;

  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'invitations') THEN
    TRUNCATE TABLE invitations CASCADE;
  END IF;

  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'organization_members') THEN
    TRUNCATE TABLE organization_members CASCADE;
  END IF;

  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'organizations') THEN
    TRUNCATE TABLE organizations CASCADE;
  END IF;
END $$;

-- ============================================================
-- 3. サブスクリプション関連データの削除
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'subscriptions') THEN
    TRUNCATE TABLE subscriptions CASCADE;
  END IF;
END $$;

-- ============================================================
-- 4. 通知データの削除
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'notifications') THEN
    TRUNCATE TABLE notifications CASCADE;
  END IF;
END $$;

-- ============================================================
-- 完了
-- ============================================================
-- データクリーンアップが完了しました。
-- 次のステップ: Phase 1（データベース構造の再構築）を実行してください。
-- ============================================================
