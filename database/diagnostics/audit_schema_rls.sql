-- ============================================================================
-- 本番スキーマ/RLS 突合 診断スクリプト（READ-ONLY）
-- ============================================================================
-- 目的: 手動適用でドリフトした prod/dev の実スキーマ・RLS を吸い出し、
--       results owner 列(#7恒久) / sessions FK 移行 / training_events anon /
--       横断 SELECT 締め直し 等の migration を「実態」に対して設計するための地盤を作る。
--
-- 使い方:
--   1) Supabase SQL Editor を開く。
--   2) このファイルの各クエリ(1〜5)を順に実行する（全部まとめて実行しても可）。
--   3) **prod と dev の両方**で実行し、それぞれの結果（各クエリの表）をこの会話に貼り戻す。
--      どちらの DB のものか（prod / dev）を明記してください。
--      ※ 結果は会話に貼るだけで良く、このファイルには貼り付けないこと（スクリプトは読み取り専用のまま保つ）。
--
-- 安全性: 本スクリプトは SELECT とシステムカタログ参照のみ。
--         CREATE / ALTER / DROP / INSERT / UPDATE / DELETE / TRUNCATE / GRANT は一切含まない。
--         データやスキーマを一切変更しません。
--
-- 各クエリが確定させる未確定事項:
--   (1) 列定義   : results に judge_id/guest_identifier が有るか / sessions.chief_judge_id・created_by の型・NOT NULL / training_scores.judge_id の型
--   (2) 制約     : results の upsert を支える一意制約の「名前と列」 / check_judge_or_guest / sessions の chief_judge_id・created_by の FK と ON DELETE
--   (3) 索引     : results / training_scores の(部分)一意索引の完全定義
--   (4) RLS有効  : 各テーブルで RLS が有効か
--   (5) ポリシー : results の anon/authenticated ポリシー実体 / training_events の anon SELECT 有無 /
--                  session_participants・participants・scoring_prompts の USING(true) 横断 SELECT /
--                  authed INSERT ポリシー(judge_name チェック無し疑い)の本番有無
--
-- 対象テーブル（必要なら各クエリの IN(...) を編集）:
--   results, sessions, training_scores, session_participants, participants,
--   scoring_prompts, training_events, custom_events, profiles, training_sessions
-- ============================================================================


-- ============================================================================
-- (1) 列定義
-- ============================================================================
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'results', 'sessions', 'training_scores', 'session_participants', 'participants',
    'scoring_prompts', 'training_events', 'custom_events', 'profiles', 'training_sessions'
  )
order by table_name, ordinal_position;


-- ============================================================================
-- (2) 制約（PRIMARY KEY / UNIQUE / CHECK / FOREIGN KEY + FK の ON DELETE）
-- ============================================================================
select
  c.conrelid::regclass::text as table_name,
  c.conname as constraint_name,
  case c.contype
    when 'p' then 'PRIMARY KEY'
    when 'u' then 'UNIQUE'
    when 'c' then 'CHECK'
    when 'f' then 'FOREIGN KEY'
    else c.contype::text
  end as constraint_type,
  pg_get_constraintdef(c.oid) as definition,
  case c.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else null
  end as fk_on_delete
from pg_constraint c
where c.connamespace = 'public'::regnamespace
  and c.conrelid::regclass::text in (
    'results', 'sessions', 'training_scores', 'session_participants', 'participants',
    'scoring_prompts', 'training_events', 'custom_events', 'profiles', 'training_sessions'
  )
order by table_name, constraint_type, constraint_name;


-- ============================================================================
-- (3) 索引（unique / partial を含む完全定義）
-- ============================================================================
select
  t.relname as table_name,
  i.relname as index_name,
  ix.indisunique as is_unique,
  ix.indisprimary as is_primary,
  pg_get_indexdef(ix.indexrelid) as index_def
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname in (
    'results', 'sessions', 'training_scores', 'session_participants', 'participants',
    'scoring_prompts', 'training_events', 'custom_events', 'profiles', 'training_sessions'
  )
order by table_name, index_name;


-- ============================================================================
-- (4) RLS 有効フラグ
-- ============================================================================
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'results', 'sessions', 'training_scores', 'session_participants', 'participants',
    'scoring_prompts', 'training_events', 'custom_events', 'profiles', 'training_sessions'
  )
order by table_name;


-- ============================================================================
-- (5) RLS ポリシー一覧（USING / WITH CHECK 全文）
-- ============================================================================
select
  tablename,
  policyname,
  cmd,
  roles::text as roles,
  coalesce(qual, '') as using_expr,
  coalesce(with_check, '') as with_check_expr
from pg_policies
where schemaname = 'public'
  and tablename in (
    'results', 'sessions', 'training_scores', 'session_participants', 'participants',
    'scoring_prompts', 'training_events', 'custom_events', 'profiles', 'training_sessions'
  )
order by tablename, cmd, policyname;
