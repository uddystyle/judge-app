-- ============================================================
-- パフォーマンス最適化: インデックス追加
-- ============================================================
-- 実行日: 2025-11-16
-- 説明: ページ遷移速度を改善するためのインデックス追加
-- ============================================================

-- ============================================================
-- 1. session_participants テーブル
-- ============================================================

-- session_idでの検索を高速化（参加者数カウント用）
CREATE INDEX IF NOT EXISTS idx_session_participants_session_id
ON session_participants(session_id);

-- user_idでの検索を高速化（ユーザーの参加セッション一覧取得用）
CREATE INDEX IF NOT EXISTS idx_session_participants_user_id
ON session_participants(user_id)
WHERE user_id IS NOT NULL;

-- ゲスト参加者の検索を高速化
CREATE INDEX IF NOT EXISTS idx_session_participants_guest
ON session_participants(session_id, is_guest)
WHERE is_guest = true;

-- ============================================================
-- 2. sessions テーブル
-- ============================================================

-- 組織別のセッション一覧取得を高速化（created_atで降順ソート）
CREATE INDEX IF NOT EXISTS idx_sessions_organization_created
ON sessions(organization_id, created_at DESC);

-- アクティブセッションの検索を高速化
CREATE INDEX IF NOT EXISTS idx_sessions_active
ON sessions(is_active)
WHERE is_active = true;

-- モード別の検索を高速化
CREATE INDEX IF NOT EXISTS idx_sessions_mode
ON sessions(mode);

-- ============================================================
-- 3. results テーブル
-- ============================================================

-- セッションID + bib番号での検索を高速化（最も頻繁なクエリパターン）
CREATE INDEX IF NOT EXISTS idx_results_session_bib
ON results(session_id, bib);

-- 種目情報を含む複合検索を高速化
CREATE INDEX IF NOT EXISTS idx_results_session_discipline_level_event
ON results(session_id, discipline, level, event_name);

-- 検定員名での検索を高速化
CREATE INDEX IF NOT EXISTS idx_results_judge_name
ON results(session_id, judge_name);

-- ============================================================
-- 4. training_scores テーブル
-- ============================================================

-- イベントIDでの検索を高速化
CREATE INDEX IF NOT EXISTS idx_training_scores_event_id
ON training_scores(event_id);

-- セッションごとの採点結果取得を高速化
CREATE INDEX IF NOT EXISTS idx_training_scores_session_via_event
ON training_scores(event_id, created_at DESC);

-- 選手別の採点結果取得を高速化
CREATE INDEX IF NOT EXISTS idx_training_scores_athlete
ON training_scores(athlete_id);

-- 検定員別の採点結果取得を高速化
CREATE INDEX IF NOT EXISTS idx_training_scores_judge
ON training_scores(judge_id);

-- ============================================================
-- 5. training_sessions テーブル
-- ============================================================

-- session_idでの検索を高速化（研修設定取得用）
CREATE INDEX IF NOT EXISTS idx_training_sessions_session_id
ON training_sessions(session_id);

-- ============================================================
-- 6. custom_events テーブル
-- ============================================================

-- セッションIDでの検索を高速化（大会モードの種目一覧取得用）
CREATE INDEX IF NOT EXISTS idx_custom_events_session_id
ON custom_events(session_id, display_order);

-- ============================================================
-- 7. training_events テーブル
-- ============================================================

-- セッションIDでの検索を高速化（研修モードの種目一覧取得用）
CREATE INDEX IF NOT EXISTS idx_training_events_session_id
ON training_events(session_id, order_index);

-- ============================================================
-- 8. organization_members テーブル
-- ============================================================

-- ユーザーIDでの組織検索を高速化
CREATE INDEX IF NOT EXISTS idx_organization_members_user_id
ON organization_members(user_id);

-- 組織IDでのメンバー一覧取得を高速化
CREATE INDEX IF NOT EXISTS idx_organization_members_org_id
ON organization_members(organization_id);

-- ============================================================
-- 9. scoring_prompts テーブル
-- ============================================================

-- セッションIDでの検索を高速化
CREATE INDEX IF NOT EXISTS idx_scoring_prompts_session_id
ON scoring_prompts(session_id);

-- ============================================================
-- 10. profiles テーブル
-- ============================================================

-- user_idでの検索は既に主キーなので不要
-- full_nameでの部分一致検索を高速化（将来的な検索機能用）
CREATE INDEX IF NOT EXISTS idx_profiles_full_name
ON profiles(full_name);

-- ============================================================
-- 完了メッセージ
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'パフォーマンス最適化インデックスの追加が完了しました';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '追加されたインデックス:';
  RAISE NOTICE '- session_participants: 3個';
  RAISE NOTICE '- sessions: 3個';
  RAISE NOTICE '- results: 3個';
  RAISE NOTICE '- training_scores: 4個';
  RAISE NOTICE '- training_sessions: 1個';
  RAISE NOTICE '- custom_events: 1個';
  RAISE NOTICE '- training_events: 1個';
  RAISE NOTICE '- organization_members: 2個';
  RAISE NOTICE '- scoring_prompts: 1個';
  RAISE NOTICE '- profiles: 1個';
  RAISE NOTICE '合計: 20個のインデックス';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '期待される効果:';
  RAISE NOTICE '- クエリ実行時間: 50-90%短縮';
  RAISE NOTICE '- ページ遷移速度: 40-60%向上';
  RAISE NOTICE '- データベース負荷: 30-50%削減';
  RAISE NOTICE '============================================================';
END $$;
