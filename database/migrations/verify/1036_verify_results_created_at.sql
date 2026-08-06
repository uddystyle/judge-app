-- ============================================================================
-- Verify 1036: results.created_at のデフォルト
-- ============================================================================
-- prod / dev の**両方**で実行する。読み取りのみ。
-- ============================================================================

-- (A) デフォルトが付いているか
--     期待: column_default = 'now()'
select column_name, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'results' and column_name = 'created_at';

-- (B) 既存行は NULL のまま残っているか（埋めていないことの確認）
--     期待: 適用前と同じ NULL 件数。減っていたら誰かが推測値で埋めている
select count(*) as 全件,
       count(created_at) as 記録あり,
       count(*) - count(created_at) as 記録なし,
       min(created_at) as 最古の記録
from public.results;

-- (C) コメントが付いているか（event_id が死んだ列であることの明示を含む）
select a.attname as column_name, col_description(a.attrelid, a.attnum) as comment
from pg_attribute a
where a.attrelid = 'public.results'::regclass
  and a.attname in ('created_at', 'event_id');
