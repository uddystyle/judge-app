-- パフォーマンス改善のためのインデックス追加
-- 作成日: 2025年

-- 1. participants テーブルの複合インデックス
-- session_id と bib_number の組み合わせでの検索を高速化
CREATE INDEX IF NOT EXISTS idx_participants_session_bib
ON participants(session_id, bib_number);

-- 2. session_participants テーブルのゲスト検索最適化
-- ゲストユーザーの検索を高速化（部分インデックス）
CREATE INDEX IF NOT EXISTS idx_session_participants_guest_identifier
ON session_participants(guest_identifier, is_guest)
WHERE is_guest = true;

-- 3. results テーブルの検索最適化
-- セッションIDとゼッケン番号での検索を高速化
CREATE INDEX IF NOT EXISTS idx_results_session_bib
ON results(session_id, bib);

-- 4. training_scores テーブルの検索最適化
-- イベントIDでの検索を高速化
CREATE INDEX IF NOT EXISTS idx_training_scores_event_id
ON training_scores(event_id);
